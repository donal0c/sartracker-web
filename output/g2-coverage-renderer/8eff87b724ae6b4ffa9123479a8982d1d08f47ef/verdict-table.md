| Candidate | Fixture | Verdict | First useful worst warm ms | Complete worst warm ms | Filter worst warm ms | Main max worst warm ms | Renderer p95 worst warm ms | Settled / peak GiB | query / segment / encode / source / settle median ms |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| A | bcp-2m | REJECT | 5432 | 13593 | 196 | 58 | 150 | 0.92 / 0.97 | 6899 / 1279 / 0 / 58 / 3091 |
| A | bcp-960k | REJECT | 8732 | 9480 | 204 | 53 | 184 | 0.64 / 0.64 | 6239 / 1314 / 0 / 81 / 3461 |
| B | bcp-2m | PASS | 3334 | 7554 | 104 | 33 | 84 | 0.27 / 0.27 | 5000 / 985 / 300 / 0 / 3641 |
| B | bcp-960k | PASS | 3465 | 5976 | 133 | 58 | 117 | 0.26 / 0.26 | 3509 / 798 / 217 / 0 / 3396 |
| C | bcp-2m | REJECT | 8500 | 9208 | 349 | 55 | 117 | 1.32 / 1.38 | 4953 / 947 / 0 / 2 / 2583 |
| C | bcp-960k | REJECT | 5806 | 6555 | 178 | 51 | 67 | 0.83 / 1.01 | 2960 / 604 / 0 / 2 / 2138 |
