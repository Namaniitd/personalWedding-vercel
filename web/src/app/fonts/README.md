# Bundled fonts

These WOFF2 files are self-hosted so the frontend build and guest pages do not depend on Google Fonts being reachable. The existing variable fonts were downloaded from the Google Fonts CSS API on 30 September 2026. The two regular fonts for the couple names were downloaded on 14 October 2026. Lora was downloaded on 19 October 2026. The matching SIL Open Font Licenses, including copyright notices, are in `licenses/`.

| Files | Subset | Source | License |
| --- | --- | --- | --- |
| `cormorant-garamond-latin-*.woff2` | Latin, normal and italic, v21 | [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) | `licenses/cormorantgaramond-OFL.txt` |
| `lora-latin-*.woff2` | Latin, normal and italic, variable 400–700, v37 | [Lora CSS API](https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400..700;1,400..700&display=swap) | `licenses/lora-OFL.txt` |
| `dm-sans-latin-variable.woff2` | Latin, v17 | [DM Sans](https://fonts.google.com/specimen/DM+Sans) | `licenses/dmsans-OFL.txt` |
| `noto-sans-devanagari-variable.woff2` | Devanagari, v30 | [Noto Sans Devanagari](https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari) | `licenses/notosansdevanagari-OFL.txt` |
| `eczar-devanagari-variable.woff2` | Devanagari, v27 | [Eczar](https://fonts.google.com/specimen/Eczar) | `licenses/eczar-OFL.txt` |
| `great-vibes-latin-regular.woff2` | Latin, normal 400, v21 | [Great Vibes CSS API](https://fonts.googleapis.com/css2?family=Great+Vibes:wght@400&display=swap) | `licenses/greatvibes-OFL.txt` |
| `tiro-devanagari-hindi-devanagari-regular.woff2` | Devanagari, normal 400, v7 | [Tiro Devanagari Hindi CSS API](https://fonts.googleapis.com/css2?family=Tiro+Devanagari+Hindi:ital@0&display=swap) | `licenses/tirodevanagarihindi-OFL.txt` |

Great Vibes is used for the English couple names, and Tiro Devanagari Hindi for the Hindi couple names. Their SIL Open Font License 1.1 files were downloaded from the official Google Fonts repository: [Great Vibes](https://github.com/google/fonts/blob/main/ofl/greatvibes/OFL.txt) and [Tiro Devanagari Hindi](https://github.com/google/fonts/blob/main/ofl/tirodevanagarihindi/OFL.txt). Both assets are static regular fonts; configure their weight as `400` and style as `normal`.

Lora is used for editorial headings, monograms, and italic event numbers. Its SIL Open Font License 1.1 was downloaded from the [official Google Fonts repository](https://github.com/google/fonts/blob/main/ofl/lora/OFL.txt). Both files are variable fonts; configure their weight range as `400 700` and their respective styles as `normal` and `italic`.

The Devanagari files are intentionally not preloaded on English pages. The browser uses the configured fallback stack for Latin characters within Hindi text.
