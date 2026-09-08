// A shared hub, local neighbourhoods and cross-group links exercise the router
// at the size of the reported 130-table/479-relationship database.
export function denseErdSchema() {
  const tables = Array.from({ length: 130 }, (_, index) => ({
    name: `table_${index}`, schema: "public", qualifiedName: `public.table_${index}`, kind: "table",
    columns: [
      { name: "id", nativeType: "integer", nullable: false },
      ...Array.from({ length: 4 }, (_, field) => ({ name: `parent_${field}`, nativeType: "integer", nullable: true })),
      ...Array.from({ length: 11 }, (_, field) => ({ name: `field_${field}`, nativeType: "text", nullable: true }))
    ],
    keys: [{ name: `table_${index}_pkey`, columns: ["id"], primary: true }]
  }));
  const relationships = Array.from({ length: 479 }, (_, index) => {
    const child = index % 129 + 1;
    const field = Math.floor(index / 129);
    const parent = [0, Math.floor(child / 10) * 10, (child + 37) % 130, (child * 7) % 130][field];
    return {
      id: `fk_${index}`, constraintName: `fk_${index}`, columns: [`parent_${field}`], referencedColumns: ["id"],
      sourceTable: tables[child].qualifiedName, referencedTable: tables[parent].qualifiedName
    };
  });
  return { engine: "postgresql", database: "erd_test", refreshedAt: "2026-09-08T00:00:00Z", schemas: [{ name: "public" }], tables, relationships };
}
