# Changelog

All notable changes to SSV Network contracts will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v1.0.1.rc4] - 2023-09-19

### Fixed

- [22d2859](https://github.com/bloxapp/ssv-network/pull/262/commits/22d2859d8fe6267b09c7a1c9c645df19bdaa03ff) Fix bug in network earnings withdrawals.
- [d25d188](https://github.com/bloxapp/ssv-network/pull/265/commits/d25d18886459e631fb4453df7a47db19982ec80e) Fix Types.shrink() bug.

### Added
- [bf0c51d](https://github.com/bloxapp/ssv-network/pull/263/commits/bf0c51d4df191018052d11425c9fcc252de61431) A validator can voluntarily exit.


## [Released]

## [v1.0.0.rc4] - 2023-08-31

- Audit fixes/recommendations
- Validate a cluster with 0 validators can not be liquidated
- Deployment process now uses hardhat tasks
- The DAO can set a maximum operator fee (SSV)
- Remove the setRegisterAuth function (register operator/validator without restrictions)
- SSVNetworkViews contract does not throw an error as a way of return.
