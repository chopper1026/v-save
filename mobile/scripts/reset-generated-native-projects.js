const fs = require('node:fs');
const path = require('node:path');

const GENERATED_NATIVE_FOLDERS = ['ios', 'android'];

function removeGeneratedNativeProjects(projectRoot = process.cwd()) {
  const removed = [];

  for (const folderName of GENERATED_NATIVE_FOLDERS) {
    const targetPath = path.join(projectRoot, folderName);
    if (!fs.existsSync(targetPath)) {
      continue;
    }

    fs.rmSync(targetPath, { recursive: true, force: true });
    removed.push(folderName);
  }

  return {
    projectRoot,
    removed,
  };
}

if (require.main === module) {
  const result = removeGeneratedNativeProjects();

  if (result.removed.length === 0) {
    console.log('No generated native folders to remove');
  } else {
    console.log(`Removed generated native folders: ${result.removed.join(', ')}`);
  }
}

module.exports = {
  GENERATED_NATIVE_FOLDERS,
  removeGeneratedNativeProjects,
};
