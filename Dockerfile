FROM node:18-alpine

COPY . /usr/src/app

WORKDIR /usr/src/app

RUN apk add --update --no-cache python3 && ln -sf python3 /usr/bin/python

RUN apk add git

RUN apk add make g++ py3-pip

RUN yarn global add ts-node

RUN yarn install

RUN yarn add --save-dev "@nomicfoundation/hardhat-network-helpers@^1.0.0" "@nomicfoundation/hardhat-chai-matchers@^1.0.0" "@nomiclabs/hardhat-etherscan@^3.0.0" "@typechain/ethers-v5@^10.1.0" "@typechain/hardhat@^6.1.2" "chai@^4.2.0" "hardhat-gas-reporter@^1.0.8" "solidity-coverage@^0.8.1" "typechain@^8.1.0"


ENTRYPOINT ["sleep", "999999"]
