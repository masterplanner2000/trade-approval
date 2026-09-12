import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const localPython = ".venv-ibkr-10.49/bin/python";
const python = existsSync(localPython) ? localPython : (process.env.PYTHON ?? "python3");
const result = spawnSync(
  python,
  ["-m", "unittest", "discover", "-s", "service", "-p", "test_*.py", "-v"],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`Unable to start Python tests with ${python}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
