{
  description = "mc-compose: The composition repository for the nerima-games Minecraft-clone rebuild: Layer merge, the single total ordering of frame stages, session lifecycle, the QA/debug API and the modding entry point. It holds no game rules.";

  inputs = {
    # nixos-unstable, not nixpkgs-unstable: it advances only after the NixOS
    # release tests pass, so it is less likely to land a broken build.
    #
    # Locked to a specific revision rather than `nix flake update`: the
    # nixos-unstable head at Wave 0 time ships oxlint >=1.79.0, whose
    # `no-redeclare` rule misfires on the `type X = ... & Brand` +
    # `const X = Brand.refined(...)` idiom used across this org's packages.
    # oxlint 1.75.0 (this revision) is clean against that idiom. Re-check on
    # the next nixpkgs bump.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      # Only what is actually exercised: x86_64-linux by CI, aarch64-darwin by
      # the maintainer. Declaring a platform nothing builds makes
      # `nix flake check --all-systems` fail rather than skip it.
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: nixpkgs.legacyPackages.${system};
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          # Node 24 matches the `engines` field and the CI runner. pnpm comes
          # from corepack rather than nixpkgs so that the version is decided by
          # the `packageManager` field in package.json — one source of truth
          # instead of two that can drift.
          #
          # oxlint and ast-grep are intentionally supplied by Nix rather than
          # package.json/npm: this keeps the executable versions in the
          # reproducible development shell and avoids a second package-manager
          # lockfile entry. ast-grep covers what oxlint cannot (no
          # no-restricted-syntax/no-restricted-properties/no-restricted-globals
          # equivalents implemented) via `.ast-grep/rules/`.
          #
          # No `pkgs.playwright-driver.browsers` / `PLAYWRIGHT_BROWSERS_PATH`
          # here: at this repo's pinned nixpkgs revision that driver ships
          # 1.61.1, which can never serve @playwright/test's pinned 1.62.1 —
          # confirmed by `browserType.launch: Executable doesn't exist`
          # against the wrong chromium_headless_shell revision. `npx
          # playwright install --with-deps chromium` (local, and the
          # `e2e-browser` CI job before `pnpm e2e:browser` runs) uses
          # playwright's own cache instead, which always matches the npm pin
          # exactly — the same pattern mx-ui's flake already uses.
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.corepack_24
              pkgs.typescript-language-server
              pkgs.oxlint
              pkgs.ast-grep
            ];

            shellHook = ''
              corepackDir="$(mktemp -d "''${TMPDIR:-/tmp}/mc-compose-corepack.XXXXXX")"
              corepack enable --install-directory "$corepackDir"
              export PATH="$corepackDir:$PATH"
            '';
          };
        }
      );
    };
}
