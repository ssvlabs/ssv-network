// Legacy import path (test/helpers/index.ts, test/forked). The former copy here was
// token-identical to gas-usage.ts but kept its own stats and gas-report.json writer, so a
// process loading both could overwrite the report. Re-export the single tracker instead.
export * from './gas-usage.ts';
