import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/'] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
);
