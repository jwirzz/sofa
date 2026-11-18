# sofa
```
 .-="""""""""""=-.
 | . . . . . . . |                __
 | .'.'.'.'.'.'. |     ___  ___  / _| __ _
()_______________()   / __|/ _ \| |_ / _` |
||_______________||   \__ \ (_) |  _| (_| |
 W               W    |___/\___/|_|  \__,_|
```
simple one-file agent configuration

## Install

No Deno or Node required:

```sh
curl -fsSL https://raw.githubusercontent.com/jwirzz/sofa/main/install.sh | sh
```

Installs to `~/.sofa/bin` (override with `SOFA_INSTALL`); pin a version with `SOFA_VERSION=v0.1.0`.

## Release

Push a tag to build binaries with `deno compile` and publish a GitHub release:

```sh
git tag v0.1.0 && git push origin v0.1.0
```
