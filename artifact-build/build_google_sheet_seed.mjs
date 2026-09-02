import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "outputs/01a0628c-226f-7053-9e1a-7f4ec5f1bd4c";
await fs.mkdir(outputDir, { recursive: true });

const definitions = [
  {
    name: "CONFIG",
    headers: ["CLAVE", "VALOR"],
    rows: [
      ["EMPRESA", "Campaña de Salud"],
      ["TITULO_APP", "Reserva tu cita"],
      ["DURACION_SLOT", "15"],
      ["ZONA_HORARIA", "America/Lima"],
      ["RESERVAS_POR_PERSONA", "1"],
    ],
    widths: [28, 28],
  },
  {
    name: "CAMPANAS",
    headers: ["campaign_id", "nombre", "descripcion", "fecha_inicio", "fecha_fin", "activo", "created_at", "updated_at"],
    rows: [],
    widths: [18, 26, 42, 16, 16, 12, 24, 24],
  },
  {
    name: "HORARIOS",
    headers: ["slot_id", "campaign_id", "fecha", "inicio", "fin", "capacidad", "ocupados", "estado", "created_at", "updated_at"],
    rows: [],
    widths: [38, 18, 16, 12, 12, 12, 12, 16, 24, 24],
  },
  {
    name: "PERSONAS",
    headers: ["person_id", "dni", "nombres", "apellidos", "telefono", "area", "correo", "created_at", "updated_at"],
    rows: [],
    widths: [38, 14, 24, 28, 18, 24, 30, 24, 24],
  },
  {
    name: "RESERVAS",
    headers: ["reservation_id", "reservation_code", "campaign_id", "slot_id", "person_id", "dni", "fecha", "hora", "estado", "created_at", "updated_at"],
    rows: [],
    widths: [38, 20, 18, 38, 38, 14, 16, 12, 16, 24, 24],
  },
  {
    name: "AUDITORIA",
    headers: ["timestamp", "accion", "reservation_id", "dni", "detalle"],
    rows: [],
    widths: [24, 24, 38, 14, 60],
  },
  {
    name: "AGENDA_MEDICO",
    headers: ["fecha", "hora", "DNI", "nombres", "apellidos", "area", "estado", "reservation_code"],
    rows: [],
    widths: [16, 12, 14, 24, 28, 24, 16, 20],
  },
];

const workbook = Workbook.create();
const headerFormat = {
  fill: "#0F766E",
  font: { bold: true, color: "#FFFFFF", size: 11 },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
  borders: { preset: "outside", style: "thin", color: "#0B4F4A" },
};
const bodyFormat = {
  font: { color: "#1F2937", size: 10 },
  verticalAlignment: "center",
};

for (const definition of definitions) {
  const sheet = workbook.worksheets.add(definition.name);
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  const headerEnd = String.fromCharCode(64 + definition.headers.length);
  const headerRange = sheet.getRange(`A1:${headerEnd}1`);
  headerRange.values = [definition.headers];
  headerRange.format = headerFormat;
  headerRange.format.rowHeight = 30;

  if (definition.rows.length > 0) {
    const endRow = definition.rows.length + 1;
    const bodyRange = sheet.getRange(`A2:${headerEnd}${endRow}`);
    bodyRange.values = definition.rows;
    bodyRange.format = bodyFormat;
    bodyRange.format.borders = { preset: "insideHorizontal", style: "thin", color: "#E5E7EB" };
    bodyRange.format.rowHeight = 22;
  }

  for (let index = 0; index < definition.widths.length; index += 1) {
    const col = String.fromCharCode(65 + index);
    sheet.getRange(`${col}:${col}`).format.columnWidth = definition.widths[index];
  }
}

const overview = await workbook.inspect({
  kind: "workbook,sheet,region",
  maxChars: 6000,
  tableMaxRows: 8,
  tableMaxCols: 12,
  tableMaxCellChars: 80,
});
await fs.writeFile(`${outputDir}/seed-inspect.ndjson`, overview.ndjson ?? "", "utf8");

for (const definition of definitions) {
  const preview = await workbook.render({ sheetName: definition.name, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(`${outputDir}/${definition.name}.png`, new Uint8Array(await preview.arrayBuffer()));
}

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "seed formula error scan",
});
await fs.writeFile(`${outputDir}/seed-errors.ndjson`, errors.ndjson ?? "", "utf8");

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(`${outputDir}/campana-salud-google-sheets.xlsx`);
