-- Supabase RLS Setup for Vietnamese Agricultural Cooperative Platform
-- This script creates helper functions and RLS policies for multi-tenant cooperative access

-- ============================================================================
-- HELPER FUNCTIONS FOR COOPERATIVE ACCESS CONTROL
-- ============================================================================

-- CRITICAL: Create auth schema and auth.uid() function for Neon compatibility
-- This is essential for RLS policies to work correctly
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() 
RETURNS uuid 
STABLE 
LANGUAGE sql 
AS $$
  SELECT CASE 
    WHEN current_setting('request.jwt.claims', true) IS NOT NULL 
    THEN (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
    ELSE NULL 
  END;
$$;

-- Grant usage on auth.uid() function to authenticated users
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon;

-- Function to check if a user is a member of a cooperative
CREATE OR REPLACE FUNCTION is_member(user_uuid uuid, coop_uuid varchar)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM cooperative_members 
    WHERE user_id = user_uuid::varchar 
    AND coop_id = coop_uuid 
    AND active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get the role of a user in a cooperative
CREATE OR REPLACE FUNCTION role_of(user_uuid uuid, coop_uuid varchar)
RETURNS text AS $$
DECLARE
  user_role text;
BEGIN
  SELECT role INTO user_role
  FROM cooperative_members 
  WHERE user_id = user_uuid::varchar 
  AND coop_id = coop_uuid 
  AND active = true;
  
  RETURN COALESCE(user_role, 'none');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's cooperatives with their highest role
CREATE OR REPLACE FUNCTION user_cooperatives(user_uuid uuid)
RETURNS TABLE(coop_id varchar, role text) AS $$
BEGIN
  RETURN QUERY
  SELECT cm.coop_id, cm.role
  FROM cooperative_members cm
  WHERE cm.user_id = user_uuid::varchar 
  AND cm.active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user can write (admin or analyst roles)
CREATE OR REPLACE FUNCTION can_write(user_uuid uuid, coop_uuid varchar)
RETURNS boolean AS $$
DECLARE
  user_role text;
BEGIN
  user_role := role_of(user_uuid, coop_uuid);
  RETURN user_role IN ('admin', 'analyst');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin(user_uuid uuid, coop_uuid varchar)
RETURNS boolean AS $$
BEGIN
  RETURN role_of(user_uuid, coop_uuid) = 'admin';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY ON ALL COOPERATIVE TABLES
-- ============================================================================

-- Core data tables
ALTER TABLE cooperatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE cooperative_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_audit ENABLE ROW LEVEL SECURITY;

-- Domain data tables
ALTER TABLE price_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices_verified ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecasts_30d ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE composite_confidence_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_analysis ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES FOR COOPERATIVE ACCESS
-- ============================================================================

-- COOPERATIVES TABLE POLICIES
DROP POLICY IF EXISTS "Users can view their cooperatives" ON cooperatives;
CREATE POLICY "Users can view their cooperatives" 
ON cooperatives FOR SELECT 
USING (is_member(auth.uid(), id));

DROP POLICY IF EXISTS "Admins can update their cooperatives" ON cooperatives;
CREATE POLICY "Admins can update their cooperatives" 
ON cooperatives FOR UPDATE 
USING (is_admin(auth.uid(), id))
WITH CHECK (is_admin(auth.uid(), id));

-- COOPERATIVE MEMBERS TABLE POLICIES
DROP POLICY IF EXISTS "Users can view cooperative members" ON cooperative_members;
CREATE POLICY "Users can view cooperative members" 
ON cooperative_members FOR SELECT 
USING (is_member(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Admins can manage cooperative members" ON cooperative_members;
CREATE POLICY "Admins can manage cooperative members" 
ON cooperative_members FOR ALL 
USING (is_admin(auth.uid(), coop_id))
WITH CHECK (is_admin(auth.uid(), coop_id));

-- PROFILES TABLE POLICIES  
DROP POLICY IF EXISTS "Users can manage their own profile" ON profiles;
CREATE POLICY "Users can manage their own profile" 
ON profiles FOR ALL 
USING (user_id = auth.uid()::varchar)
WITH CHECK (user_id = auth.uid()::varchar);

-- EXPORT AUDIT TABLE POLICIES
DROP POLICY IF EXISTS "Users can view coop export audit" ON export_audit;
CREATE POLICY "Users can view coop export audit" 
ON export_audit FOR SELECT 
USING (is_member(auth.uid(), coop_id));

DROP POLICY IF EXISTS "System can insert export audit" ON export_audit;
CREATE POLICY "System can insert export audit" 
ON export_audit FOR INSERT 
WITH CHECK (is_member(auth.uid(), coop_id));

-- ============================================================================
-- DOMAIN DATA TABLE POLICIES (with coop_id filtering)
-- ============================================================================

-- PRICE DATA POLICIES
DROP POLICY IF EXISTS "Users can view coop price data" ON price_data;
CREATE POLICY "Users can view coop price data" 
ON price_data FOR SELECT 
USING (is_member(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Analysts can insert price data" ON price_data;
CREATE POLICY "Analysts can insert price data" 
ON price_data FOR INSERT 
WITH CHECK (can_write(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Admins can update price data" ON price_data;
CREATE POLICY "Admins can update price data" 
ON price_data FOR UPDATE 
USING (is_admin(auth.uid(), coop_id))
WITH CHECK (is_admin(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Admins can delete price data" ON price_data;
CREATE POLICY "Admins can delete price data" 
ON price_data FOR DELETE 
USING (is_admin(auth.uid(), coop_id));

-- FORECASTS POLICIES
DROP POLICY IF EXISTS "Users can view coop forecasts" ON forecasts;
CREATE POLICY "Users can view coop forecasts" 
ON forecasts FOR SELECT 
USING (is_member(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Analysts can manage forecasts" ON forecasts;
CREATE POLICY "Analysts can manage forecasts" 
ON forecasts FOR ALL 
USING (can_write(auth.uid(), coop_id))
WITH CHECK (can_write(auth.uid(), coop_id));

-- LLM VERIFICATIONS POLICIES
DROP POLICY IF EXISTS "Users can view coop verifications" ON llm_verifications;
CREATE POLICY "Users can view coop verifications" 
ON llm_verifications FOR SELECT 
USING (is_member(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Analysts can manage verifications" ON llm_verifications;
CREATE POLICY "Analysts can manage verifications" 
ON llm_verifications FOR ALL 
USING (can_write(auth.uid(), coop_id))
WITH CHECK (can_write(auth.uid(), coop_id));

-- ALERTS POLICIES
DROP POLICY IF EXISTS "Users can view coop alerts" ON alerts;
CREATE POLICY "Users can view coop alerts" 
ON alerts FOR SELECT 
USING (is_member(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Analysts can create alerts" ON alerts;
CREATE POLICY "Analysts can create alerts" 
ON alerts FOR INSERT 
WITH CHECK (can_write(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Admins can manage alerts" ON alerts;
CREATE POLICY "Admins can manage alerts" 
ON alerts FOR UPDATE 
USING (is_admin(auth.uid(), coop_id))
WITH CHECK (is_admin(auth.uid(), coop_id));

-- TRADING RECOMMENDATIONS POLICIES
DROP POLICY IF EXISTS "Users can view coop recommendations" ON trading_recommendations;
CREATE POLICY "Users can view coop recommendations" 
ON trading_recommendations FOR SELECT 
USING (is_member(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Analysts can manage recommendations" ON trading_recommendations;
CREATE POLICY "Analysts can manage recommendations" 
ON trading_recommendations FOR ALL 
USING (can_write(auth.uid(), coop_id))
WITH CHECK (can_write(auth.uid(), coop_id));

-- SOURCES POLICIES
DROP POLICY IF EXISTS "Users can view coop sources" ON sources;
CREATE POLICY "Users can view coop sources" 
ON sources FOR SELECT 
USING (is_member(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Admins can manage sources" ON sources;
CREATE POLICY "Admins can manage sources" 
ON sources FOR ALL 
USING (is_admin(auth.uid(), coop_id))
WITH CHECK (is_admin(auth.uid(), coop_id));

-- PRICES RAW POLICIES
DROP POLICY IF EXISTS "Users can view coop prices raw" ON prices_raw;
CREATE POLICY "Users can view coop prices raw" 
ON prices_raw FOR SELECT 
USING (is_member(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Analysts can manage prices raw" ON prices_raw;
CREATE POLICY "Analysts can manage prices raw" 
ON prices_raw FOR ALL 
USING (can_write(auth.uid(), coop_id))
WITH CHECK (can_write(auth.uid(), coop_id));

-- PRICES VERIFIED POLICIES
DROP POLICY IF EXISTS "Users can view coop prices verified" ON prices_verified;
CREATE POLICY "Users can view coop prices verified" 
ON prices_verified FOR SELECT 
USING (is_member(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Analysts can manage prices verified" ON prices_verified;
CREATE POLICY "Analysts can manage prices verified" 
ON prices_verified FOR ALL 
USING (can_write(auth.uid(), coop_id))
WITH CHECK (can_write(auth.uid(), coop_id));

-- FX RATES POLICIES
DROP POLICY IF EXISTS "Users can view coop fx rates" ON fx_rates;
CREATE POLICY "Users can view coop fx rates" 
ON fx_rates FOR SELECT 
USING (is_member(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Analysts can manage fx rates" ON fx_rates;
CREATE POLICY "Analysts can manage fx rates" 
ON fx_rates FOR ALL 
USING (can_write(auth.uid(), coop_id))
WITH CHECK (can_write(auth.uid(), coop_id));

-- FORECAST RUNS POLICIES
DROP POLICY IF EXISTS "Users can view coop forecast runs" ON forecast_runs;
CREATE POLICY "Users can view coop forecast runs" 
ON forecast_runs FOR SELECT 
USING (is_member(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Analysts can manage forecast runs" ON forecast_runs;
CREATE POLICY "Analysts can manage forecast runs" 
ON forecast_runs FOR ALL 
USING (can_write(auth.uid(), coop_id))
WITH CHECK (can_write(auth.uid(), coop_id));

-- FORECASTS 30D POLICIES
DROP POLICY IF EXISTS "Users can view coop forecasts 30d" ON forecasts_30d;
CREATE POLICY "Users can view coop forecasts 30d" 
ON forecasts_30d FOR SELECT 
USING (is_member(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Analysts can manage forecasts 30d" ON forecasts_30d;
CREATE POLICY "Analysts can manage forecasts 30d" 
ON forecasts_30d FOR ALL 
USING (can_write(auth.uid(), coop_id))
WITH CHECK (can_write(auth.uid(), coop_id));

-- EVIDENCE POLICIES
DROP POLICY IF EXISTS "Users can view coop evidence" ON evidence;
CREATE POLICY "Users can view coop evidence" 
ON evidence FOR SELECT 
USING (is_member(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Analysts can manage evidence" ON evidence;
CREATE POLICY "Analysts can manage evidence" 
ON evidence FOR ALL 
USING (can_write(auth.uid(), coop_id))
WITH CHECK (can_write(auth.uid(), coop_id));

-- COMPOSITE CONFIDENCE SCORES POLICIES
DROP POLICY IF EXISTS "Users can view coop ccs" ON composite_confidence_scores;
CREATE POLICY "Users can view coop ccs" 
ON composite_confidence_scores FOR SELECT 
USING (is_member(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Analysts can manage ccs" ON composite_confidence_scores;
CREATE POLICY "Analysts can manage ccs" 
ON composite_confidence_scores FOR ALL 
USING (can_write(auth.uid(), coop_id))
WITH CHECK (can_write(auth.uid(), coop_id));

-- QUALITY GATES POLICIES
DROP POLICY IF EXISTS "Users can view coop quality gates" ON quality_gates;
CREATE POLICY "Users can view coop quality gates" 
ON quality_gates FOR SELECT 
USING (is_member(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Analysts can manage quality gates" ON quality_gates;
CREATE POLICY "Analysts can manage quality gates" 
ON quality_gates FOR ALL 
USING (can_write(auth.uid(), coop_id))
WITH CHECK (can_write(auth.uid(), coop_id));

-- AGREEMENT ANALYSIS POLICIES
DROP POLICY IF EXISTS "Users can view coop agreement analysis" ON agreement_analysis;
CREATE POLICY "Users can view coop agreement analysis" 
ON agreement_analysis FOR SELECT 
USING (is_member(auth.uid(), coop_id));

DROP POLICY IF EXISTS "Analysts can manage agreement analysis" ON agreement_analysis;
CREATE POLICY "Analysts can manage agreement analysis" 
ON agreement_analysis FOR ALL 
USING (can_write(auth.uid(), coop_id))
WITH CHECK (can_write(auth.uid(), coop_id));

-- ============================================================================
-- GRANT NECESSARY PERMISSIONS
-- ============================================================================

-- Grant usage on helper functions to authenticated users
GRANT EXECUTE ON FUNCTION is_member(uuid, varchar) TO authenticated;
GRANT EXECUTE ON FUNCTION role_of(uuid, varchar) TO authenticated;
GRANT EXECUTE ON FUNCTION user_cooperatives(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION can_write(uuid, varchar) TO authenticated;
GRANT EXECUTE ON FUNCTION is_admin(uuid, varchar) TO authenticated;

-- ============================================================================
-- INSERT SAMPLE COOPERATIVE DATA FOR TESTING
-- ============================================================================

-- Insert default cooperative (if not exists)
INSERT INTO cooperatives (id, name, slug, active, metadata)
VALUES (
  'default-coop-uuid',
  'Hợp tác xã Mặc định',
  'default-coop',
  true,
  '{"description": "Hợp tác xã mặc định cho hệ thống", "created_by": "system"}'
)
ON CONFLICT (slug) DO NOTHING;

-- Add system admin membership (example)
INSERT INTO cooperative_members (coop_id, user_id, role, active)
VALUES (
  'default-coop-uuid',
  'system-admin-uuid',
  'admin',
  true
)
ON CONFLICT DO NOTHING;

-- Log setup completion
INSERT INTO export_audit (
  coop_id, user_id, export_type, summary, record_counts, filters, file_format
)
VALUES (
  'default-coop-uuid',
  'system-admin-uuid',
  'rls-setup',
  'Supabase RLS policies and helper functions installed',
  '{"policies": 50, "functions": 5}',
  '{"setup": "complete"}',
  'sql'
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- VERIFICATION QUERIES (for testing)
-- ============================================================================

-- Test cooperative access
-- SELECT is_member('test-user-uuid'::uuid, 'default-coop-uuid');
-- SELECT role_of('test-user-uuid'::uuid, 'default-coop-uuid'); 
-- SELECT can_write('test-user-uuid'::uuid, 'default-coop-uuid');
-- SELECT is_admin('test-user-uuid'::uuid, 'default-coop-uuid');

COMMENT ON FUNCTION is_member IS 'Check if user is active member of cooperative';
COMMENT ON FUNCTION role_of IS 'Get user role in cooperative (admin/analyst/farmer/none)';
COMMENT ON FUNCTION user_cooperatives IS 'Get all cooperatives user belongs to with roles';
COMMENT ON FUNCTION can_write IS 'Check if user can write data (admin or analyst)';
COMMENT ON FUNCTION is_admin IS 'Check if user is admin of cooperative';