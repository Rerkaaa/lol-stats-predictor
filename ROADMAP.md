# Project status and prediction roadmap

This is a candid audit of the current repository. “Not implemented” means the requested outcome is not present end-to-end, even if groundwork exists.

## Previously requested but not implemented

1. **Public pro-player tracker and simultaneous multi-profile search.** The private dev workspace can store pro identities and accounts, but there is no public team/player directory or batch comparison screen yet.
2. **Automatic pro-account analysis.** Managed accounts are not automatically refreshed, aggregated, or converted into predictor features.
3. **LEC roster/account seed data.** No verified LEC player-account dataset has been imported. This needs user-supplied accounts or a source with explicit reuse permission.
4. **Manual pro data affecting predictions.** Managed teams/players are separate from statistical LoL and Valorant team identities, so a dev-page roster change does not yet change a forecast.
5. **True last-five-season finishing ranks.** Riot’s current API does not provide an authoritative historical finish endpoint. The site can only build snapshots after it begins tracking someone.
6. **Automatic full Summoner history in one update.** Each update imports a bounded page to protect Riot rate limits; repeated updates are currently needed for older games.
7. **Complete calculation/model handbook and user guide.** The README describes the main model, but a field-by-field data dictionary, formula-level model card, and full task-oriented guide remain to be written.
8. **Managed image uploads.** League/team/player images in the dev page currently use direct HTTPS URLs; R2 upload and asset management are not present.
9. **Full edit operations in the dev page.** Records can be created and removed, but existing records cannot yet be edited in place.
10. **Every historical season and every possible source field.** The active LoL product intentionally covers 2022 onward; unavailable source values remain missing rather than being invented.

## Started but unfinished or fragile

1. **Leaguepedia series linkage:** series metadata is stored, but LoL match grouping still relies mainly on date, stage, and team pairing. Same-day rematches can therefore be grouped incorrectly.
2. **Series-specific models:** Bo3/Bo5 values are currently derived from a map probability with an independent-map formula. Map order, vetoes, side choice, and between-map adaptation are not fitted separately.
3. **Valorant contextual features:** head-to-head, draft, and rolling meta are shown, but some remain confidence/context adjustments because they did not improve the historical replay.
4. **Unused Valorant fields:** event tier, patch, ACS, rating, headshots, and opening-duel fields are partly stored but not all are used in the winner model.
5. **Cross-source deduplication:** Oracle and Games of Legends use different source identifiers. A canonical real-world match fingerprint is still needed to guarantee the same map cannot enter through both feeds.
6. **Team aliases and rebrands:** exact-name matching can split one organization across spelling variants, abbreviations, or rebrands.
7. **Fallback data quality:** recent Games of Legends imports fill freshness gaps but do not provide every Oracle statistic, so coverage varies by map.
8. **R2 freshness:** the mirror only becomes newer after the upstream Oracle download succeeds. When Google Drive is quota-blocked, the old mirror cannot create new data by itself.
9. **Scraper regression tests:** HTML parsers for third-party schedules/matches need saved fixtures and automated tests because page markup can change without notice.
10. **Accuracy deployment gate:** backtests run in GitHub, but there is no automatic rule that compares against a stored baseline and blocks a weaker model deployment.
11. **Evaluation isolation:** trial weights and headline results are currently evaluated over the same replay. A locked temporal test period and confidence intervals are needed.
12. **Forward prediction ledger:** the site does not yet timestamp and freeze every real pre-match prediction before the match begins.
13. **Frontend consolidation:** the original `app.js` grew through many incremental feature layers. The new navigation is isolated, but the legacy Live League setup should eventually be consolidated into one router and component.
14. **Legacy text encoding:** the new UI layer repairs visible broken punctuation at runtime, but older source strings should eventually be rewritten as clean UTF-8.
15. **Dev visual controls:** the editor stores muted/border values, but not every saved token is consumed by the public theme renderer; the preview is also intentionally basic.

## Highest-priority work to improve prediction quality

The order matters: model accuracy will not be trustworthy until identity and evaluation are reliable.

### 1. Data identity and quality

- Add canonical match fingerprints across Oracle, Games of Legends, Leaguepedia, and VLR.
- Add team/player alias and rebrand tables.
- Link Leaguepedia series IDs to imported LoL maps.
- Track field-level provenance, freshness, and completeness for every map.
- Treat a missing objective as missing, never as an observed zero.

### 2. Trustworthy evaluation

- Use rolling-origin train/validation/test periods with the newest period locked.
- Report accuracy, Brier score, log loss, calibration, sample size, and bootstrap confidence intervals.
- Break results down by league, region, patch, event tier, and Bo format.
- Persist a model version and baseline; automatically reject deployments that regress on the locked test set.
- Store every real pre-match forecast in an immutable public prediction ledger.

### 3. Roster and series identity

- Connect managed pro players/accounts to canonical team and player IDs.
- Confirm all five LoL starters or five Valorant starters before applying lineup features.
- Compute role-specific recent form and roster synergy.
- Train series outcomes separately using only information available before map one.

### 4. LoL candidates to test

- Dynamic opponent and regional strength instead of tournament-name heuristics alone.
- Role-vs-role lane form and roster synergy.
- Pre-draft champion-pool patch readiness by player and role.
- Reliable currently underused fields: GPM, towers, heralds, damage, and draft history.
- Count-distribution models for kills and survival/quantile models for duration.

### 5. Valorant candidates to test

- Map veto/pick order and map-specific strength.
- Attack/defence splits, pistol conversion, anti-eco conversion, overtime, and clutch rates where the source is reliable.
- Event-tier, regional strength, and schedule difficulty.
- Temporally validate stored ACS, rating, opening-duel, headshot, patch, and agent-pool features.
- Fit separate Bo1/Bo3/Bo5 models instead of converting a single all-map probability.

### 6. Reliability and performance

- Cache periodic Elo snapshots instead of rebuilding all history on each request.
- Add parser fixtures, import freshness alerts, and data-health banners.
- Add request cancellation so rapid filter changes cannot show an older response.
- Publish a model/data card explaining limitations, missing inputs, and the last successful backtest.

