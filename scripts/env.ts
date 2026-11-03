// Imported first by CLI scripts so env vars are set before other modules load.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });
