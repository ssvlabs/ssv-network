const { execSync } = require('child_process');
const chalk = require('chalk');
const contract = process.argv[2];

const exec = commands => {
  try {
    execSync(commands, { stdio: 'inherit', shell: true }); // Specify the shell if needed
  } catch (error) {}
};

const echidnaPath = '/usr/local/bin/echidna';
console.log(echidnaPath);
switch (contract) {
  case 'Operators':
    exec(echidnaPath + ' --config echidna.yaml --contract Operators contracts/modules/Operators.sol');
    break;
  case 'Clusters':
    exec(echidnaPath + ' --config echidna.yaml --contract Clusters contracts/modules/Clusters.sol');
    break;
  case 'DAO':
    exec(echidnaPath + ' --config echidna.yaml --contract DAO contracts/modules/DAO.sol');
    break;
  default:
    console.log(chalk.redBright('Invalid contract name. Use Operators, Clusters, or DAO.'));
    console.log(chalk.greenBright('npm run echidna <Operators | Clusters | DAO>'));
}
