# Monetization and promotion guide

The strongest position for this service is not “another stats site.” It is a transparent, cross-title **professional esports intelligence product**: forecasts, roster context, match history, live schedules, and a public record of how the models perform.

## Do not monetize until these checks are complete

1. Register the product and its current features in Riot’s Developer Portal. Riot says monetization is available to products with an Approved or Acknowledged status, requires a free tier, permits transformative subscriptions/donations/advertising, and prohibits betting or gambling functionality. Review the current [Riot General Policies](https://developer.riotgames.com/policies/general), [LoL developer policy](https://developer.riotgames.com/docs/lol), and [VALORANT developer policy](https://developer.riotgames.com/docs/valorant).
2. Add Riot’s currently required non-endorsement notice visibly in the footer/About area. Also follow [Riot’s Legal Jibber Jabber](https://www.riotgames.com/en/legal) for fan projects, branding, advertising, and use of Riot intellectual property.
3. Update the registered product description when adding material features such as pro-account tracking, lineup alerts, live embeds, or paid tiers.
4. Keep API keys server-side. Do not sell or expose raw Riot or third-party datasets.
5. Do not add bookmaker links, sportsbook affiliates, odds comparison, bet slips, stake sizing, “locks,” or betting calls to action. Present percentages as analytical forecasts with uncertainty and calibration.
6. Audit every data source before commercial use. Public access does not equal commercial permission.
7. For VALORANT personal player data, Riot requires player opt-in through RSO; being a known professional player is not a substitute for consent.
8. Confirm permission for team logos, league marks, images, and broadcast embeds. A public image URL is not automatically a reusable license.
9. Add Privacy, Cookies, Terms, Sources/Attribution, Methodology, Data Status, Model Changelog, and Responsible Forecasting pages.

### Source-specific cautions

- PandaScore’s [current terms](https://www.pandascore.co/terms-and-condition) permit certain subscribed data uses but prohibit odds-related products. Because a win probability may plausibly be interpreted as odds-related, obtain written clarification before monetizing a predictor that uses PandaScore-derived data.
- Leaguepedia content it can license is described under its [CC BY-SA copyright page](https://lol.fandom.com/wiki/Leaguepedia%3ACopyrights). Attribution and ShareAlike may apply; logos can have separate owners.
- If display advertising serves EEA/UK/Swiss visitors, follow Google’s current [consent-management requirements](https://support.google.com/adsense/answer/7670013) and [privacy disclosure guidance](https://support.google.com/adsense/answer/10961370).

## Recommended revenue ladder

### Phase 1 — prove repeat use

- Keep the whole core product free.
- Add a supporter/donation option after Riot registration is in order.
- Seek one direct, non-gambling sponsor for a weekly model report: peripherals, PCs, chairs, esports education, or creator tools.
- Use clearly disclosed non-gambling affiliate links for relevant hardware/software. The US FTC requires material relationships to be clear and conspicuous; see its [endorsement guidance](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking).
- Avoid generic display ads at low traffic; they add clutter and usually produce little revenue.

### Phase 2 — paid analyst convenience

Keep schedules, results, basic forecasts, and historical accuracy free. A roughly €4–€8/month Supporter/Analyst tier could add genuinely transformative convenience:

- saved team watchlists and alerts;
- confirmed-lineup and roster-change alerts;
- advanced historical filters and patch/tournament splits;
- generated scouting reports and downloadable analysis summaries;
- forecast-movement history and a full model-version archive;
- ad-free interface;
- custom Discord/email notifications.

Do not sell raw API access or dataset exports. Sell the analysis, workflow, and generated report.

### Phase 3 — pro/media product

- Custom scouting briefs for teams, coaches, casters, and esports media.
- Branded forecast widgets and broadcast-safe graphics.
- Newsroom dashboards and tournament hubs.
- Methodology/data-quality consulting.
- Sponsored weekly “Model Report” content with clear editorial independence.

Seek Riot and source approval before offering any commercial B2B package.

## How to differentiate around the pro scene

1. **Public prediction ledger:** timestamp every forecast before play and show every correct and incorrect result, Brier score, log loss, calibration, and model version. Never cherry-pick.
2. **Pre-draft vs post-draft modes:** make it impossible to confuse information known before betting/draft lock with information learned later.
3. **Lineup-aware team identity:** substitutions, role swaps, coach changes, player synergy, patch readiness, rest/travel, and strength of schedule.
4. **“What changed?” brief:** one screen explaining roster, form, patch, opponent strength, and model movement since the previous series.
5. **Series simulator:** likely scorelines, map-by-map uncertainty, map pool, and accuracy for the relevant confidence band.
6. **Data-health transparency:** freshness and coverage for each forecast, with confidence automatically reduced when inputs are missing.
7. **LoL pro SoloQ tracker:** verified multi-account aggregation, role/champion trends, rank movement, and alerts. Handle VALORANT personal data only through Riot-approved opt-in.
8. **Cross-title dashboard:** a coherent LoL and VALORANT pro hub is a useful niche that single-game trackers do not cover well.
9. **Wrong-prediction reviews:** publish short postmortems explaining what the model missed and whether a model change is justified.
10. **Creator/media tools:** embeddable forecast cards, spoiler-free mode, citation links, and shareable tournament graphics.

## Promotion plan

### Technical distribution

- Replace public hash-only views over time with stable crawlable URLs for every match, team, player, league, tournament, forecast, and model report.
- Give each page a unique title, description, canonical URL, and social share image.
- Create an XML sitemap and submit it to Search Console. Google explains the role of sitemaps in its [official documentation](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview).
- Publish original analysis instead of automatically generated thin pages. Follow Google’s [people-first content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).

### Content engine

- Daily: “three matches where the model moved.”
- Weekly: patch/form report and the coming week’s most uncertain series.
- Monthly: complete accuracy, calibration, and data-health audit.
- After major errors: a public postmortem.
- During tournaments: one canonical hub with schedule, live links, forecasts, results, rosters, and model record.

### Community growth

- Generate useful matchup cards for Discord, X, Bluesky, Reddit, and team communities; follow each community’s self-promotion rules.
- Build a Discord bot or email alert for upcoming matches, confirmed roster changes, forecast movement, and final results.
- Partner with smaller analysts, casters, coaches, and fan communities. Offer free branded reports/widgets for feedback and attribution, without implying official endorsement.
- Use short video for one-minute forecast explanations, patch/meta summaries, and monthly calibration recaps. YouTube’s current partner overview is [here](https://support.google.com/youtube/answer/72851).
- Localize high-value LEC/team/tournament pages only after the English versions are consistently useful.

## A practical 90-day sequence

### Days 1–30: trust

- Complete Riot/product/source compliance review.
- Add the required legal, source, methodology, and data-status pages.
- Build the forward prediction ledger and public accuracy dashboard.
- Track returning users, saved teams, notification interest, and report opens.

### Days 31–60: distribution

- Add stable shareable match/team URLs and social cards.
- Publish daily/weekly/monthly editorial formats.
- Launch a small Discord and recruit ten regular testers from pro-scene communities.
- Offer free widgets to a handful of small creators/casters.

### Days 61–90: first revenue test

- Add donations/supporter status.
- Test one direct non-gambling sponsor on the weekly report.
- Collect interest for alerts, advanced filters, generated scouting reports, and ad-free use.
- Only build a subscription after repeat usage and willingness-to-pay are visible.

## Metrics that matter

- weekly returning users;
- saved teams and alert opt-ins;
- prediction-ledger views and report completion;
- forecast-card shares and referral traffic;
- calibration and Brier score, not just raw accuracy;
- freshness/coverage failures per league;
- free-to-supporter conversion and supporter retention;
- creator/widget referrals.

The core business advantage should be trust: the site shows what it knew, when it knew it, what it predicted, and how it performed over time.

