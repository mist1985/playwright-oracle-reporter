/**
 * Optional runtime environment loading.
 *
 * The reporter and CLI can read a local `.env` file when `dotenv`
 * is available at runtime. Existing process environment variables
 * are left untouched because `dotenv.config()` does not override by default.
 */

let dotenvLoadAttempted = false;
let dotenvLoaded = false;

export function loadDotenvIfAvailable(): boolean {
  if (dotenvLoadAttempted) {
    return dotenvLoaded;
  }

  dotenvLoadAttempted = true;

  try {
    require("dotenv").config();
    dotenvLoaded = true;
  } catch {
    dotenvLoaded = false;
  }

  return dotenvLoaded;
}
