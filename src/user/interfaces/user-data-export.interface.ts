export interface UserDataExportFile {
  fileName: string;
  content: Buffer;
}

export interface ExportDocument {
  id: string;
  data: Record<string, unknown>;
}

export type ExportColumnKind =
  'text' | 'number' | 'money' | 'date' | 'date_time';

export interface ExportColumn {
  header: string;
  kind: ExportColumnKind;
  value: (document: ExportDocument) => unknown;
}
