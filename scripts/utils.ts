export function getEnvVar(envVar: string) {
    if (!process.env[envVar]) {
        throw (`${envVar} not set. Check .env file`)
    }
    return String(process.env[envVar]);
}