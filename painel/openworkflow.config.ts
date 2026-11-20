// Configuração lida pelo @openworkflow/dashboard (procura openworkflow.config.* a partir do cwd).
// Aponta para o mesmo SQLite do worker, no volume `amigo-workflows` montado em /data.
import { BackendSqlite } from "openworkflow/sqlite";

export default { backend: BackendSqlite.connect(process.env.OW_DB ?? "/data/ow.db") };
