// Root ESLint config (flat config)
// Purpose: prevent ESLint from attempting to parse Solidity files as JS/TS.
export default [
  {
    ignores: ["**/*.sol", "packages/foundry/**"],
  },
];
