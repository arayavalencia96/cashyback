import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

import { FirebaseAdminService } from 'src/common/services/firebase.service';

import type {
  ExportColumn,
  ExportColumnKind,
  ExportDocument,
  UserDataExportFile,
} from './interfaces/user-data-export.interface';

const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const HEADER_FILL = 'FF0F172A';
const HEADER_TEXT = 'FFFFFFFF';
const ACCENT_COLOR = 'FF38BDF8';
const ROW_BORDER = 'FFE2E8F0';
const MONEY_FORMAT = '#,##0.00';
const NUMBER_FORMAT = '#,##0.########';
const DATE_FORMAT = 'dd/mm/yyyy';
const DATE_TIME_FORMAT = 'dd/mm/yyyy hh:mm:ss';

@Injectable()
export class UserDataExportService {
  constructor(private readonly firebaseAdminService: FirebaseAdminService) {}

  /**
   * Genera un libro Excel portable con los datos personales y financieros del usuario.
   *
   * @param uid Identificador del usuario autenticado.
   * @returns Archivo XLSX con hojas y columnas en español.
   */
  async generate(uid: string): Promise<UserDataExportFile> {
    const [
      authUser,
      profile,
      budgets,
      fixedExpenses,
      variableExpenses,
      investments,
      legalConsents,
      privacyRequests,
    ] = await Promise.all([
      this.firebaseAdminService.getUser(uid),
      this.getProfile(uid),
      this.findByUser('monthlyBudgets', 'userId', uid),
      this.findByUser('fixedExpenses', 'userId', uid),
      this.findByUser('variableExpenses', 'userId', uid),
      this.findByUser('investments', 'userId', uid),
      this.findByUser('user_legal_consents', 'uid', uid),
      this.findByUser('privacy_requests', 'uid', uid),
    ]);

    const generatedAt = new Date();
    const legalConsentValue = profile?.data['legalConsent'];
    const currentLegalConsent = this.isRecord(legalConsentValue)
      ? legalConsentValue
      : null;
    const exportLegalConsents = this.completeLegalConsents(
      legalConsents,
      currentLegalConsent,
    );
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Cashy';
    workbook.lastModifiedBy = 'Cashy';
    workbook.created = generatedAt;
    workbook.modified = generatedAt;
    workbook.subject = 'Copia completa de datos personales y financieros';
    workbook.title = 'Datos de Cashy';

    this.addDataSheet(
      workbook,
      'informacion',
      [
        {
          id: 'informacion',
          data: {
            nombreExportacion: 'Copia completa de datos de Cashy',
            fechaGeneracion: generatedAt,
            zonaHoraria: ARGENTINA_TIME_ZONE,
            formatoFecha: 'DD/MM/YYYY',
            formatoFechaHora: 'DD/MM/YYYY HH:mm:ss',
            alcance:
              'Incluye datos de cuenta, presupuestos mensuales, ingresos, gastos fijos, gastos puntuales, gastos variables, inversiones, consentimientos legales y solicitudes de privacidad.',
            datosNoIncluidos:
              'Cashy no exporta contraseñas, tokens de acceso, códigos de recuperación ni registros internos temporales de seguridad.',
          },
        },
      ],
      [
        this.column('nombre_exportacion', 'nombreExportacion'),
        this.column('fecha_generacion', 'fechaGeneracion', 'date_time'),
        this.column('zona_horaria', 'zonaHoraria'),
        this.column('formato_fecha', 'formatoFecha'),
        this.column('formato_fecha_hora', 'formatoFechaHora'),
        this.column('alcance', 'alcance'),
        this.column('datos_no_incluidos', 'datosNoIncluidos'),
      ],
    );

    this.addDataSheet(
      workbook,
      'datos_de_la_cuenta',
      [
        {
          id: uid,
          data: {
            email: authUser.email ?? profile?.data['email'] ?? '',
            displayName:
              authUser.displayName ?? profile?.data['displayName'] ?? '',
            emailVerified: this.booleanText(authUser.emailVerified),
            disabled: this.booleanText(authUser.disabled),
            creationTime:
              authUser.metadata.creationTime ?? profile?.data['createdAt'],
            lastSignInTime: authUser.metadata.lastSignInTime,
            theme: this.translateValue(profile?.data['theme'], {
              light: 'claro',
              dark: 'oscuro',
            }),
            appTourCompletedAt: profile?.data['appTourCompletedAt'],
            salary: profile?.data['salary'],
          },
        },
      ],
      [
        { ...this.idColumn(), header: 'identificador_usuario' },
        this.column('correo_electronico', 'email'),
        this.column('nombre_visible', 'displayName'),
        this.column('correo_verificado', 'emailVerified'),
        this.column('cuenta_deshabilitada', 'disabled'),
        this.column('fecha_registro', 'creationTime', 'date_time'),
        this.column('ultimo_inicio_sesion', 'lastSignInTime', 'date_time'),
        this.column('tema_visual', 'theme'),
        this.column(
          'recorrido_inicial_completado_el',
          'appTourCompletedAt',
          'date_time',
        ),
        this.column('sueldo_registrado_en_el_perfil', 'salary', 'money'),
      ],
    );

    const orderedBudgets = this.sortByField(budgets, 'monthKey');
    const orderedFixedExpenses = this.sortByField(fixedExpenses, 'expenseDate');
    const orderedVariableExpenses = this.sortByField(
      variableExpenses,
      'expenseDate',
    );
    const orderedInvestments = this.sortByField(investments, 'transactionDate');

    this.addDataSheet(
      workbook,
      'presupuestos_mensuales',
      orderedBudgets,
      this.budgetColumns(),
    );
    this.addDataSheet(
      workbook,
      'ingresos_mensuales',
      this.extractSalaryComponents(orderedBudgets),
      [
        this.column('identificador_presupuesto', 'budgetId'),
        this.column('periodo', 'monthKey'),
        this.column('motivo', 'reason'),
        this.column('monto', 'amount', 'money'),
        this.column('fecha_creacion', 'createdAt', 'date_time'),
        this.column('fecha_actualizacion', 'updatedAt', 'date_time'),
      ],
    );
    this.addDataSheet(
      workbook,
      'gastos_fijos',
      orderedFixedExpenses,
      this.fixedExpenseColumns(),
    );
    this.addDataSheet(
      workbook,
      'gastos_puntuales',
      this.extractPunctualExpenses(orderedFixedExpenses),
      [
        this.column('identificador_gasto_fijo', 'fixedExpenseId'),
        this.column('descripcion', 'description'),
        this.column('monto', 'amount', 'money'),
        this.column('fecha_gasto', 'expenseDate', 'date'),
        this.column('notas', 'notes'),
        this.column('fecha_creacion', 'createdAt', 'date_time'),
        this.column('fecha_actualizacion', 'updatedAt', 'date_time'),
      ],
    );
    this.addDataSheet(
      workbook,
      'gastos_variables',
      orderedVariableExpenses,
      this.variableExpenseColumns(),
    );
    this.addDataSheet(
      workbook,
      'inversiones',
      orderedInvestments,
      this.investmentColumns(),
    );
    this.addDataSheet(
      workbook,
      'consentimientos_legales',
      this.sortByField(exportLegalConsents, 'acceptedAt'),
      [
        this.idColumn(),
        this.column('version_terminos_de_uso', 'termsVersion'),
        this.column('version_politica_de_privacidad', 'privacyVersion'),
        this.column('edad_minima_requerida', 'minimumAge'),
        this.mappedColumn('edad_minima_confirmada', 'minimumAgeConfirmed', {
          true: 'sí',
          false: 'no',
        }),
        this.column('fecha_aceptacion', 'acceptedAt', 'date_time'),
        this.mappedColumn('consentimiento_analiticas', 'analyticsConsent', {
          accepted: 'aceptado',
          rejected: 'rechazado',
          not_decided: 'sin_decidir',
        }),
        this.column(
          'fecha_consentimiento_analiticas',
          'analyticsConsentAt',
          'date_time',
        ),
      ],
    );
    this.addDataSheet(
      workbook,
      'solicitudes_de_privacidad',
      this.sortByField(privacyRequests, 'createdAt'),
      [
        this.idColumn(),
        this.column('correo_electronico', 'email'),
        this.mappedColumn('tipo_solicitud', 'type', {
          access: 'acceso',
          rectification: 'rectificación',
          deletion: 'eliminación',
          portability: 'portabilidad',
          objection: 'oposición',
        }),
        this.column('detalle', 'details'),
        this.mappedColumn('estado', 'status', {
          received: 'recibida',
          in_review: 'en_revisión',
          completed: 'completada',
          rejected: 'rechazada',
        }),
        this.column('fecha_creacion', 'createdAt', 'date_time'),
        this.column('fecha_actualizacion', 'updatedAt', 'date_time'),
        this.column('fecha_limite_respuesta', 'responseDueAt', 'date_time'),
      ],
    );

    const content = await workbook.xlsx.writeBuffer();
    return {
      fileName: `datos_de_cashy_${this.fileDate(generatedAt)}.xlsx`,
      content: Buffer.isBuffer(content) ? content : Buffer.from(content),
    };
  }

  private async getProfile(uid: string): Promise<ExportDocument | null> {
    const snapshot = await this.firebaseAdminService.firestore
      .collection('users')
      .doc(uid)
      .get();

    return snapshot.exists
      ? { id: snapshot.id, data: snapshot.data() ?? {} }
      : null;
  }

  private async findByUser(
    collectionName: string,
    field: 'uid' | 'userId',
    uid: string,
  ): Promise<ExportDocument[]> {
    const snapshot = await this.firebaseAdminService.firestore
      .collection(collectionName)
      .where(field, '==', uid)
      .get();

    return snapshot.docs.map((document) => ({
      id: document.id,
      data: document.data(),
    }));
  }

  private addDataSheet(
    workbook: ExcelJS.Workbook,
    sheetName: string,
    documents: ExportDocument[],
    columns: ExportColumn[],
  ): void {
    const worksheet = workbook.addWorksheet(sheetName, {
      views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
      properties: { defaultRowHeight: 20 },
      pageSetup: {
        orientation: columns.length > 8 ? 'landscape' : 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });
    worksheet.columns = columns.map((column) => ({
      header: column.header,
      key: column.header,
      width: Math.min(42, Math.max(14, column.header.length + 2)),
    }));

    for (const document of documents) {
      worksheet.addRow(
        columns.map((column) =>
          this.cellValue(column.value(document), column.kind),
        ),
      );
    }

    this.styleWorksheet(worksheet, columns);
  }

  private styleWorksheet(
    worksheet: ExcelJS.Worksheet,
    columns: ExportColumn[],
  ): void {
    const header = worksheet.getRow(1);
    header.height = 28;
    header.font = { bold: true, color: { argb: HEADER_TEXT } };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_FILL },
    };
    header.alignment = { vertical: 'middle', horizontal: 'left' };

    if (columns.length > 0) {
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: columns.length },
      };
    }

    columns.forEach((column, index) => {
      const excelColumn = worksheet.getColumn(index + 1);
      let width = column.header.length + 2;
      excelColumn.eachCell({ includeEmpty: false }, (cell, rowNumber) => {
        if (rowNumber > 1) {
          cell.border = {
            bottom: { style: 'hair', color: { argb: ROW_BORDER } },
          };
          cell.alignment = {
            vertical: 'top',
            horizontal:
              column.kind === 'number' || column.kind === 'money'
                ? 'right'
                : 'left',
            wrapText: this.shouldWrap(column.header),
          };
          cell.numFmt = this.numberFormat(column.kind);
        }
        width = Math.max(width, this.displayWidth(cell.value, column.kind));
      });
      excelColumn.width = Math.min(
        this.shouldWrap(column.header) ? 60 : 32,
        Math.max(14, width + 2),
      );
    });

    worksheet.getCell('A1').font = {
      bold: true,
      color: { argb: ACCENT_COLOR },
    };
  }

  private budgetColumns(): ExportColumn[] {
    return [
      this.idColumn(),
      this.column('periodo', 'monthKey'),
      this.column('mes', 'month', 'number'),
      this.column('año', 'year', 'number'),
      this.column('sueldo', 'salary', 'money'),
      this.booleanColumn('sueldo_definido', 'isSalaryDefined'),
      this.booleanColumn('sueldo_modificado', 'isSalaryModified'),
      this.column('objetivo_gastos_fijos', 'fixedExpensesTarget', 'money'),
      this.column(
        'objetivo_gastos_variables',
        'variableExpensesTarget',
        'money',
      ),
      this.column(
        'objetivo_ahorro_e_inversion',
        'savingsInvestmentTarget',
        'money',
      ),
      this.booleanColumn(
        'gastos_variables_modificados',
        'isVariableExpensesModified',
      ),
      this.column('fecha_creacion', 'createdAt', 'date_time'),
      this.column('fecha_actualizacion', 'updatedAt', 'date_time'),
    ];
  }

  private fixedExpenseColumns(): ExportColumn[] {
    return [
      this.idColumn(),
      this.column('descripcion', 'description'),
      this.column('categoria', 'category'),
      this.column('fecha_gasto', 'expenseDate', 'date'),
      this.column('monto_original', 'amount', 'money'),
      this.column('moneda', 'currency'),
      this.column('cotizacion_dolar', 'exchangeRate', 'money'),
      this.column('fecha_cotizacion', 'exchangeRateDate', 'date'),
      this.column('monto_en_pesos', 'amountArs', 'money'),
      this.column('fecha_vencimiento', 'dueDate', 'date'),
      this.mappedColumn('estado_pago', 'paymentStatus', {
        pending: 'pendiente',
        partial: 'parcial',
        paid: 'pagado',
      }),
      this.booleanColumn('pagado', 'isPaid'),
      this.column('monto_pago_parcial', 'partialPaymentAmount', 'money'),
      this.column('fecha_pago_parcial', 'partialPaymentDate', 'date_time'),
      this.column('fecha_pago_total', 'paidAt', 'date_time'),
      this.column('monto_gastado', 'spentAmount', 'money'),
      this.column('monto_restante', 'remainingAmount', 'money'),
      this.column('notas', 'notes'),
      this.column('fecha_creacion', 'createdAt', 'date_time'),
      this.column('fecha_actualizacion', 'updatedAt', 'date_time'),
    ];
  }

  private variableExpenseColumns(): ExportColumn[] {
    return [
      this.idColumn(),
      this.column('descripcion', 'description'),
      this.column('categoria', 'category'),
      this.column('fecha_gasto', 'expenseDate', 'date'),
      this.column('monto_original', 'amount', 'money'),
      this.column('moneda', 'currency'),
      this.column('cotizacion_dolar', 'exchangeRate', 'money'),
      this.column('fecha_cotizacion', 'exchangeRateDate', 'date'),
      this.column('monto_en_pesos', 'amountArs', 'money'),
      this.booleanColumn('tiene_promocion', 'hasPromotion'),
      this.column('monto_cubierto', 'coveredBy', 'money'),
      this.column('monto_restante', 'remainingAmount', 'money'),
      this.column('notas', 'notes'),
      this.column('fecha_creacion', 'createdAt', 'date_time'),
      this.column('fecha_actualizacion', 'updatedAt', 'date_time'),
    ];
  }

  private investmentColumns(): ExportColumn[] {
    return [
      this.idColumn(),
      this.column('ticker', 'ticker'),
      this.column('tipo_transaccion', 'transactionType'),
      this.column('fecha_transaccion', 'transactionDate', 'date'),
      this.column('fecha_venta', 'saleDate', 'date'),
      this.column('monto', 'amount', 'money'),
      this.column('monto_costo', 'costBasisAmount', 'money'),
      this.column('ganancia_perdida_en_pesos', 'gainLossArs', 'money'),
      this.column('ganancia_perdida_en_dolares', 'gainLossUsd', 'money'),
      this.column('plataforma', 'platform'),
      this.column('precio_promedio_compra', 'averagePurchasePrice', 'money'),
      this.column('cantidad', 'quantity', 'number'),
      this.column('moneda', 'currency'),
      this.column('valor_dolar_mep', 'dollarMepValue', 'money'),
      this.column('valor_dolar_mep_venta', 'saleDollarMepValue', 'money'),
      this.mappedColumn('estado_posicion', 'positionStatus', {
        open: 'abierta',
        partial: 'parcial',
        closed: 'cerrada',
        'not-applicable': 'no_aplica',
      }),
      this.column(
        'cantidad_posicion_resultante',
        'positionQuantityAfter',
        'number',
      ),
      this.column('monto_posicion_resultante', 'positionAmountAfter', 'money'),
      this.column('notas', 'notes'),
      this.column('fecha_creacion', 'createdAt', 'date_time'),
      this.column('fecha_actualizacion', 'updatedAt', 'date_time'),
    ];
  }

  private extractSalaryComponents(budgets: ExportDocument[]): ExportDocument[] {
    return budgets.flatMap((budget) => {
      const components = budget.data['salaryComponents'];
      if (!Array.isArray(components)) {
        return [];
      }

      return components.map((component, index) => ({
        id: `${budget.id}_${index + 1}`,
        data: {
          ...(this.isRecord(component) ? component : {}),
          budgetId: budget.id,
          monthKey: budget.data['monthKey'],
        },
      }));
    });
  }

  private extractPunctualExpenses(
    fixedExpenses: ExportDocument[],
  ): ExportDocument[] {
    return fixedExpenses.flatMap((fixedExpense) => {
      const punctualExpenses = fixedExpense.data['punctualExpenses'];
      if (!Array.isArray(punctualExpenses)) {
        return [];
      }

      return punctualExpenses.map((expense, index) => ({
        id: `${fixedExpense.id}_${index + 1}`,
        data: {
          ...(this.isRecord(expense) ? expense : {}),
          fixedExpenseId: fixedExpense.id,
        },
      }));
    });
  }

  private completeLegalConsents(
    legalConsents: ExportDocument[],
    currentLegalConsent: Record<string, unknown> | null,
  ): ExportDocument[] {
    if (legalConsents.length > 0 || !currentLegalConsent) {
      return legalConsents;
    }
    return [{ id: 'consentimiento_actual', data: currentLegalConsent }];
  }

  private sortByField(
    documents: ExportDocument[],
    field: string,
  ): ExportDocument[] {
    return [...documents].sort((left, right) =>
      this.sortableValue(left.data[field]).localeCompare(
        this.sortableValue(right.data[field]),
      ),
    );
  }

  private idColumn(): ExportColumn {
    return {
      header: 'identificador',
      kind: 'text',
      value: (document) => document.id,
    };
  }

  private column(
    header: string,
    field: string,
    kind: ExportColumnKind = 'text',
  ): ExportColumn {
    return { header, kind, value: (document) => document.data[field] };
  }

  private booleanColumn(header: string, field: string): ExportColumn {
    return {
      header,
      kind: 'text',
      value: (document) => this.booleanText(document.data[field]),
    };
  }

  private mappedColumn(
    header: string,
    field: string,
    translations: Readonly<Record<string, string>>,
  ): ExportColumn {
    return {
      header,
      kind: 'text',
      value: (document) =>
        this.translateValue(document.data[field], translations),
    };
  }

  private cellValue(value: unknown, kind: ExportColumnKind): ExcelJS.CellValue {
    if (value === null || value === undefined) {
      return null;
    }
    if (kind === 'date' || kind === 'date_time') {
      return this.dateValue(value, kind === 'date_time');
    }
    if (kind === 'number' || kind === 'money') {
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    }
    return this.textValue(value);
  }

  private dateValue(value: unknown, includeTime: boolean): Date | null {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split('-').map(Number);
      return new Date(Date.UTC(year, month - 1, day));
    }

    const sourceDate = this.sourceDate(value);
    if (!sourceDate) {
      return null;
    }
    const parts = this.argentinaDateParts(sourceDate);
    return new Date(
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        includeTime ? parts.hour : 0,
        includeTime ? parts.minute : 0,
        includeTime ? parts.second : 0,
      ),
    );
  }

  private sourceDate(value: unknown): Date | null {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    if (this.isRecord(value) && typeof value['toDate'] === 'function') {
      const date = value['toDate'].call(value) as unknown;
      return date instanceof Date && !Number.isNaN(date.getTime())
        ? date
        : null;
    }
    if (typeof value !== 'string') {
      return null;
    }
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : new Date(timestamp);
  }

  private argentinaDateParts(value: Date): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  } {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: ARGENTINA_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = Object.fromEntries(
      formatter
        .formatToParts(value)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    return {
      year: parts['year'],
      month: parts['month'],
      day: parts['day'],
      hour: parts['hour'],
      minute: parts['minute'],
      second: parts['second'],
    };
  }

  private translateValue(
    value: unknown,
    translations: Readonly<Record<string, string>>,
  ): unknown {
    return typeof value === 'string' ? (translations[value] ?? value) : value;
  }

  private booleanText(value: unknown): string {
    if (typeof value !== 'boolean') {
      return '';
    }
    return value ? 'sí' : 'no';
  }

  private textValue(value: unknown): string {
    if (Array.isArray(value)) {
      return value.map((entry) => this.textValue(entry)).join(' | ');
    }
    if (this.isRecord(value)) {
      return Object.entries(value)
        .map(([key, entry]) => `${key}: ${this.textValue(entry)}`)
        .join(' | ');
    }
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      typeof value === 'boolean'
    ) {
      return String(value);
    }
    return '';
  }

  private sortableValue(value: unknown): string {
    const date = this.sourceDate(value);
    if (date) {
      return date.toISOString();
    }
    return this.textValue(value);
  }

  private numberFormat(kind: ExportColumnKind): string {
    switch (kind) {
      case 'money':
        return MONEY_FORMAT;
      case 'number':
        return NUMBER_FORMAT;
      case 'date':
        return DATE_FORMAT;
      case 'date_time':
        return DATE_TIME_FORMAT;
      default:
        return '@';
    }
  }

  private displayWidth(
    value: ExcelJS.CellValue,
    kind: ExportColumnKind,
  ): number {
    if (value === null || value === undefined) {
      return 0;
    }
    if (value instanceof Date) {
      return kind === 'date_time' ? 19 : 10;
    }
    if (typeof value === 'object') {
      return 16;
    }
    return String(value).length;
  }

  private shouldWrap(header: string): boolean {
    return (
      header.includes('notas') ||
      header.includes('detalle') ||
      header.includes('alcance') ||
      header.includes('datos_no_incluidos')
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private fileDate(value: Date): string {
    const parts = this.argentinaDateParts(value);
    return [parts.day, parts.month, parts.year]
      .map((part) => String(part).padStart(2, '0'))
      .join('_');
  }
}
