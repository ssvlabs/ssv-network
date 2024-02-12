const fs = require('fs');
const path = require('path');

module.exports = {
  coverageContractDepth: 10,
  gasLimit: 10000000,
  skipFiles: getSkipFiles(['deprecated', 'test']),
};

function getSkipFiles(folders) {
  const skipFiles = [];
  const contractsPath = __dirname + '/contracts/';
  folders.forEach(folderName => {
    const testFolderPath = path.join(contractsPath, folderName);
    function readFilesRecursively(folderPath) {
      const files = fs.readdirSync(folderPath);
      files.forEach(file => {
        const filePath = path.join(folderPath, file);
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          readFilesRecursively(filePath);
        } else if (stats.isFile() && path.extname(filePath) === '.sol') {
          skipFiles.push(filePath.replace(contractsPath, ''));
        }
      });
    }
    readFilesRecursively(testFolderPath);
  });

  return skipFiles;
}
