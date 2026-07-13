module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest.setup.js'],
  // e2e/ is a separate Detox test runner (see e2e/jest.config.js, invoked via
  // `detox test`), not a unit/component test suite -- it needs the Detox
  // global environment and a running simulator/emulator, so the plain `jest`
  // run here must not try to pick it up.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/e2e/'],
  transformIgnorePatterns: [
    'node_modules/(?!(@?react-native[^/]*|@react-navigation)/)',
  ],
};
