const local = (value, fallback) => {
  const host = value || fallback;
  if (!/^127\.0\.0\.1:\d+$/.test(host)) throw new Error('Tests require a loopback emulator');
  return host;
};
export const firestoreHost = local(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
export const authHost = local(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
export const functionsOrigin = 'http://' + local(process.env.FUNCTIONS_EMULATOR_ORIGIN?.replace(/^http:\/\//, ''), '127.0.0.1:5001');
export const browserOrigin = 'http://' + local(process.env.QA_BROWSER_ORIGIN?.replace(/^http:\/\//, '').replace(/\/$/, ''), '127.0.0.1:5177');
process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
process.env.FIREBASE_AUTH_EMULATOR_HOST = authHost;
