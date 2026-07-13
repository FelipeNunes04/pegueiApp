module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      files: ['jest.setup.js', 'e2e/**/*.ts'],
      env: { jest: true },
    },
  ],
};
