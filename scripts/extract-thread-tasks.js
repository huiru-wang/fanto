const { readFile } = require("node:fs/promises");

/**
 * Return valid thread tasks from a Planner result.
 *
 * @param {unknown} result Planner JSON object or parsed value.
 * @returns {Array<object>} Thread tasks.
 */
function extractThreadTasks(result) {
  if (!result || typeof result !== "object" || !Array.isArray(result.tasks)) {
    return [];
  }

  return result.tasks.filter(
    (task) => task
      && typeof task === "object"
      && task.type === "thread"
      && Array.isArray(task.recordIds)
      && task.recordIds.length > 0
      && task.recordIds.every((id) => typeof id === "string" && id.length > 0),
  );
}

async function main() {
  const [inputPath] = process.argv.slice(2);
  if (!inputPath) {
    console.error("Usage: node scripts/extract-thread-tasks.js <planner-result.json>");
    process.exitCode = 1;
    return;
  }

  const content = await readFile(inputPath, "utf8");
  const result = JSON.parse(content);
  process.stdout.write(`${JSON.stringify(extractThreadTasks(result), null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Unable to read Planner result");
    process.exitCode = 1;
  });
}

module.exports = { extractThreadTasks };
