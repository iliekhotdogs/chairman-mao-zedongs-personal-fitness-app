// Metro config: Expo defaults. AI calls go through the Supabase `ai` Edge Function,
// so no development relays are needed.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
