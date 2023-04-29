# echidna testing

[building-secure-contracts/program-analysis/echidna at master · crytic/building-secure-contracts · GitHub](https://github.com/crytic/building-secure-contracts/tree/master/program-analysis/echidna#installation)

## run 

docker run -it -v "$PWD":/src trailofbits/eth-security-toolbox /bin/bash -c solc-select install 0.8.18 && solc-select use 0.8.18

docker run -it -v "$PWD":/src trailofbits/eth-security-toolbox 
solc-select install 0.8.18 && solc-select use 0.8.18

docker run -it -v `pwd`:/src trailofbits/eth-security-toolbox -c "solc-select install 0.8.18 && solc-select use 0.8.18"

solc-select install 0.8.18 && solc-select use 0.8.18

go to 
cd /home/training

select verison 
c 0.5.11

 && echidna /src/tests/solidity/basic/flags.sol"


-----
### run test with docker 

docker run -it -v "$PWD":/home/training trailofbits/eth-security-toolbox 

solc-select install 0.8.18 && solc-select use 0.8.18 && cd /home/training

echidna-test . --contract SSVNetworkEchidna

echidna-test . --contract SSVNetworkEchidna --config echidna-config.yml

### echidna only 

docker run -it -v `pwd`:/src echidna bash -c "solc-select install 0.5.7 && solc-select use 0.5.7 && echidna /src/tests/solidity/basic/flags.sol"


### run test 

[building-secure-contracts/how-to-test-a-property.md at master · crytic/building-secure-contracts · GitHub](https://github.com/crytic/building-secure-contracts/blob/master/program-analysis/echidna/how-to-test-a-property.md)



echidna-test template.sol

echidna-test contract.sol --contract MyContract

