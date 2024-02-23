const { execSync } = require('child_process');
const util = require('util');
const asyncExec = util.promisify(require('child_process').exec);

async function getBrewPrefixPath() {
  try {
    const { stdout } = await asyncExec('brew --prefix');
    console.log(`Homebrew prefix path: ${stdout.trim()}`);
    fuzzTestByEchidna(stdout.trim());
  } catch (error) {
    console.error(`Error: ${error}`);
  }
}

getBrewPrefixPath();

function fuzzTestByEchidna(brewPrefix) {
  const contract = process.argv[2];
  const exec = commands => {
    try {
      execSync(commands, { stdio: 'inherit', shell: true }); // Specify the shell if needed
    } catch (error) {}
  };

  const echidnaPath = brewPrefix + '/bin/echidna';
  console.log(echidnaPath);
  switch (contract) {
    case 'Operators':
      exec(echidnaPath + ' --config echidna.yaml --contract Operators contracts/echidna/Operators.sol');
      break;
    case 'Clusters':
      exec(echidnaPath + ' --config echidna.yaml --contract Clusters contracts/echidna/Clusters.sol');
      break;
    case 'DAO':
      exec(echidnaPath + ' --config echidna.yaml --contract DAO contracts/echidna/DAO.sol');
      break;
    default:
      console.log('Invalid contract name. Use Operators, Clusters, or DAO.');
      console.log('npm run echidna <Operators | Clusters | DAO>');
  }
}
