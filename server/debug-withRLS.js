#!/usr/bin/env node
/**
 * Debug withRLS function to understand why JWT context is not being set correctly
 */

import { withRLS } from './db.ts';
import { sql } from 'drizzle-orm';

const testContext = {
  coopId: 'test-coop-debug',
  userId: '123e4567-e89b-12d3-a456-426614174000',
  role: 'admin'
};

async function debugWithRLS() {
  console.log('🔍 Debugging withRLS function execution...');
  console.log('Test context:', testContext);
  
  try {
    const result = await withRLS(testContext, async (rlsDb) => {
      console.log('📍 Inside withRLS operation...');
      
      // Test 1: Check JWT context settings
      console.log('🔍 Testing JWT context settings...');
      const contextCheck = await rlsDb.execute(sql`
        SELECT 
          current_setting('request.jwt.sub', true) as jwt_sub,
          current_setting('request.jwt.claims', true) as jwt_claims
      `);
      console.log('Context check result:', contextCheck[0]);
      
      // Test 2: Check auth.uid() function
      console.log('🔍 Testing auth.uid() function...');
      const authCheck = await rlsDb.execute(sql`SELECT auth.uid() as auth_uid`);
      console.log('Auth check result:', authCheck[0]);
      
      // Test 3: Manual verification
      console.log('🔍 Manual verification...');
      const manualCheck = await rlsDb.execute(sql`
        SELECT 
          CASE 
            WHEN current_setting('request.jwt.claims', true) IS NOT NULL AND current_setting('request.jwt.claims', true) != ''
            THEN (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
            ELSE NULL 
          END as manual_uid
      `);
      console.log('Manual check result:', manualCheck[0]);
      
      return {
        jwt_sub: contextCheck[0]?.jwt_sub,
        jwt_claims: contextCheck[0]?.jwt_claims,
        auth_uid: authCheck[0]?.auth_uid,
        manual_uid: manualCheck[0]?.manual_uid
      };
    });
    
    console.log('\n✅ withRLS function completed successfully!');
    console.log('Final result:', result);
    
    // Verify results
    if (result.jwt_sub === testContext.userId) {
      console.log('✅ JWT Sub correctly set');
    } else {
      console.log('❌ JWT Sub NOT set correctly');
      console.log(`  Expected: ${testContext.userId}`);
      console.log(`  Got: ${result.jwt_sub}`);
    }
    
    if (result.auth_uid === testContext.userId) {
      console.log('✅ auth.uid() working correctly');
    } else {
      console.log('❌ auth.uid() NOT working');
      console.log(`  Expected: ${testContext.userId}`);
      console.log(`  Got: ${result.auth_uid}`);
    }
    
  } catch (error) {
    console.error('❌ withRLS function failed:', error);
    console.error('Error details:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

debugWithRLS()
  .then(() => {
    console.log('\n🔍 Debug session completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('🚨 Debug session failed:', error);
    process.exit(1);
  });