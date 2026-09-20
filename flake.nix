{
  description = "wts development environment (Apple Silicon macOS)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  inputs.hamio.url = "github:9uiLe/hamio/dd8c86c6923f692ef183152958147bf095e85daa";

  outputs = { nixpkgs, hamio, ... }:
    let
      system = "aarch64-darwin";
      pkgs = import nixpkgs { inherit system; };
    in {
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [ bun git osv-scanner coreutils hamio.packages.${system}.hamio ];
      };
    };
}
