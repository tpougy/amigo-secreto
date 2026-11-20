import { BackendSqlite } from "openworkflow/sqlite";
export default { backend: BackendSqlite.connect("./ow.db") };
