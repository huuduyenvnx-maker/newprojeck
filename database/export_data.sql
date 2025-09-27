-- AgriIntel Database Export Script
-- Run these commands to export your data from PostgreSQL

-- Export critical tables to CSV
\copy commodities TO 'commodities.csv' WITH CSV HEADER;
\copy regions TO 'regions.csv' WITH CSV HEADER;
\copy prices_raw TO 'prices_raw.csv' WITH CSV HEADER;
\copy prices_verified TO 'prices_verified.csv' WITH CSV HEADER;
\copy forecasts TO 'forecasts.csv' WITH CSV HEADER;
\copy forecasts_30d TO 'forecasts_30d.csv' WITH CSV HEADER;
\copy llm_verifications TO 'llm_verifications.csv' WITH CSV HEADER;
\copy quality_gates TO 'quality_gates.csv' WITH CSV HEADER;
\copy composite_confidence_scores TO 'composite_confidence_scores.csv' WITH CSV HEADER;
\copy agreement_analysis TO 'agreement_analysis.csv' WITH CSV HEADER;
\copy evidence TO 'evidence.csv' WITH CSV HEADER;
\copy sources TO 'sources.csv' WITH CSV HEADER;
\copy alerts TO 'alerts.csv' WITH CSV HEADER;
\copy users TO 'users.csv' WITH CSV HEADER;
\copy cooperatives TO 'cooperatives.csv' WITH CSV HEADER;
\copy cooperative_members TO 'cooperative_members.csv' WITH CSV HEADER;
\copy profiles TO 'profiles.csv' WITH CSV HEADER;
\copy roles TO 'roles.csv' WITH CSV HEADER;
\copy forecast_runs TO 'forecast_runs.csv' WITH CSV HEADER;
\copy trading_recommendations TO 'trading_recommendations.csv' WITH CSV HEADER;
\copy fx_rates TO 'fx_rates.csv' WITH CSV HEADER;
\copy price_data TO 'price_data.csv' WITH CSV HEADER;
\copy export_audit TO 'export_audit.csv' WITH CSV HEADER;

-- Alternative: Single command to export all data as INSERT statements
-- pg_dump --data-only --inserts your_database_url > agriintel_data_only.sql