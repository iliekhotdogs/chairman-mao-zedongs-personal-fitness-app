// Run every test in a fixed time zone that has daylight saving time, so date logic is
// exercised across DST changes and results don't depend on the machine (CI runs in UTC).
// Must be set here: changing process.env.TZ inside a test file does not reach Node.
module.exports = async () => {
  process.env.TZ = 'America/New_York';
};
