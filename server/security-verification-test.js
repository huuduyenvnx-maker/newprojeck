#!/usr/bin/env node
/**
 * CRITICAL SECURITY VERIFICATION TEST
 * 
 * This script tests the emergency security fixes for:
 * 1. JWT context leakage prevention
 * 2. auth.uid() function verification
 * 3. Cross-tenant isolation
 */

import { withRLS, pool } from './db.ts';
import { sql } from 'drizzle-orm';

const COOP_A_CONTEXT = {
  coopId: 'test-coop-a',
  userId: '123e4567-e89b-12d3-a456-426614174000', // Valid UUID
  role: 'admin'
};

const COOP_B_CONTEXT = {
  coopId: 'test-coop-b', 
  userId: '223e4567-e89b-12d3-a456-426614174001', // Valid UUID
  role: 'admin'
};

async function runSecurityVerificationTests() {
  console.log('🚨 RUNNING CRITICAL SECURITY VERIFICATION TESTS 🚨');
  console.log('==================================================');
  
  let allTestsPassed = true;
  
  // Test 1: Verify auth.uid() function exists and works
  try {
    console.log('\n🔍 TEST 1: Verifying auth.uid() function...');
    
    const uidA = await withRLS(COOP_A_CONTEXT, async (rlsDb) => {
      const result = await rlsDb.execute(sql`SELECT auth.uid() as user_id`);
      return result[0]?.user_id;
    });
    
    const uidB = await withRLS(COOP_B_CONTEXT, async (rlsDb) => {
      const result = await rlsDb.execute(sql`SELECT auth.uid() as user_id`);
      return result[0]?.user_id;
    });
    
    if (uidA === COOP_A_CONTEXT.userId && uidB === COOP_B_CONTEXT.userId && uidA !== uidB) {
      console.log('✅ auth.uid() function working correctly');
      console.log(`   - User A ID: ${uidA}`);
      console.log(`   - User B ID: ${uidB}`);
    } else {
      console.log('❌ auth.uid() function test FAILED');
      console.log(`   - Expected A: ${COOP_A_CONTEXT.userId}, Got: ${uidA}`);
      console.log(`   - Expected B: ${COOP_B_CONTEXT.userId}, Got: ${uidB}`);
      allTestsPassed = false;
    }
  } catch (error) {
    console.log('❌ auth.uid() function test FAILED with error:', error.message);
    allTestsPassed = false;
  }

  // Test 2: JWT Context Isolation Test (CRITICAL)
  try {
    console.log('\n🔒 TEST 2: JWT Context Isolation (CRITICAL SECURITY TEST)...');
    
    const results = [];
    
    // Rapid user switching to test connection pool isolation
    for (let i = 0; i < 6; i++) {
      const context = i % 2 === 0 ? COOP_A_CONTEXT : COOP_B_CONTEXT;
      const expectedUserId = context.userId;
      
      const result = await withRLS(context, async (rlsDb) => {
        const queryResult = await rlsDb.execute(sql`
          SELECT current_setting('request.jwt.sub', true) as jwt_sub,
                 auth.uid() as auth_uid
        `);
        return {
          jwt_sub: queryResult[0]?.jwt_sub,
          auth_uid: queryResult[0]?.auth_uid,
          expected: expectedUserId,
          iteration: i
        };
      });
      
      results.push(result);
    }
    
    // Verify no context leakage
    let isolationTestPassed = true;
    for (let i = 0; i < results.length; i++) {
      const expected = i % 2 === 0 ? COOP_A_CONTEXT.userId : COOP_B_CONTEXT.userId;
      if (results[i].jwt_sub !== expected || results[i].auth_uid !== expected) {
        console.log(`❌ Context leakage detected at iteration ${i}:`);
        console.log(`   - Expected: ${expected}`);
        console.log(`   - JWT Sub: ${results[i].jwt_sub}`);
        console.log(`   - Auth UID: ${results[i].auth_uid}`);
        isolationTestPassed = false;
        allTestsPassed = false;
      }
    }
    
    if (isolationTestPassed) {
      console.log('✅ JWT Context Isolation verified - NO LEAKAGE DETECTED!');
      console.log('   - Tested 6 rapid user switches');
      console.log('   - All contexts properly isolated');
    }
    
  } catch (error) {
    console.log('❌ JWT Context Isolation test FAILED with error:', error.message);
    allTestsPassed = false;
  }

  // Test 3: Connection Pool Cleanup Test
  try {
    console.log('\n🧼 TEST 3: Connection Pool Cleanup Test...');
    
    // User A operation
    await withRLS(COOP_A_CONTEXT, async (rlsDb) => {
      await rlsDb.execute(sql`SELECT 1 as test`);
      return true;
    });
    
    // User B operation (should have clean context, not User A's)
    const userBResult = await withRLS(COOP_B_CONTEXT, async (rlsDb) => {
      const result = await rlsDb.execute(sql`
        SELECT current_setting('request.jwt.sub', true) as jwt_sub,
               current_setting('request.jwt.claims', true) as jwt_claims,
               auth.uid() as auth_uid
      `);
      return result[0];
    });
    
    if (userBResult.jwt_sub === COOP_B_CONTEXT.userId && 
        userBResult.auth_uid === COOP_B_CONTEXT.userId) {
      const claims = JSON.parse(userBResult.jwt_claims);
      if (claims.coop_id === COOP_B_CONTEXT.coopId) {
        console.log('✅ Connection Pool Cleanup verified');
        console.log(`   - User B got correct context: ${userBResult.jwt_sub}`);
        console.log(`   - User B got correct coop: ${claims.coop_id}`);
      } else {
        console.log('❌ Connection Pool Cleanup FAILED - wrong coop_id');
        allTestsPassed = false;
      }
    } else {
      console.log('❌ Connection Pool Cleanup FAILED - context contamination');
      console.log(`   - Expected: ${COOP_B_CONTEXT.userId}`);
      console.log(`   - JWT Sub: ${userBResult.jwt_sub}`);
      console.log(`   - Auth UID: ${userBResult.auth_uid}`);
      allTestsPassed = false;
    }
    
  } catch (error) {
    console.log('❌ Connection Pool Cleanup test FAILED with error:', error.message);
    allTestsPassed = false;
  }

  // Test 4: Concurrent Operations Test
  try {
    console.log('\n🏃‍♂️ TEST 4: Concurrent Multi-Tenant Operations...');
    
    const concurrentPromises = [
      withRLS(COOP_A_CONTEXT, async (rlsDb) => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
        const result = await rlsDb.execute(sql`SELECT auth.uid() as uid`);
        return { uid: result[0]?.uid, expected: COOP_A_CONTEXT.userId, tenant: 'A' };
      }),
      withRLS(COOP_B_CONTEXT, async (rlsDb) => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
        const result = await rlsDb.execute(sql`SELECT auth.uid() as uid`);
        return { uid: result[0]?.uid, expected: COOP_B_CONTEXT.userId, tenant: 'B' };
      }),
      withRLS(COOP_A_CONTEXT, async (rlsDb) => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
        const result = await rlsDb.execute(sql`SELECT auth.uid() as uid`);
        return { uid: result[0]?.uid, expected: COOP_A_CONTEXT.userId, tenant: 'A2' };
      }),
      withRLS(COOP_B_CONTEXT, async (rlsDb) => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
        const result = await rlsDb.execute(sql`SELECT auth.uid() as uid`);
        return { uid: result[0]?.uid, expected: COOP_B_CONTEXT.userId, tenant: 'B2' };
      })
    ];
    
    const concurrentResults = await Promise.all(concurrentPromises);
    
    let concurrentTestPassed = true;
    for (const result of concurrentResults) {
      if (result.uid !== result.expected) {
        console.log(`❌ Concurrent test FAILED for tenant ${result.tenant}:`);
        console.log(`   - Expected: ${result.expected}`);
        console.log(`   - Got: ${result.uid}`);
        concurrentTestPassed = false;
        allTestsPassed = false;
      }
    }
    
    if (concurrentTestPassed) {
      console.log('✅ Concurrent Multi-Tenant Operations verified');
      console.log('   - All 4 concurrent operations maintained correct context');
    }
    
  } catch (error) {
    console.log('❌ Concurrent Operations test FAILED with error:', error.message);
    allTestsPassed = false;
  }

  // Final Results
  console.log('\n==================================================');
  if (allTestsPassed) {
    console.log('🎉 ALL SECURITY TESTS PASSED! 🎉');
    console.log('✅ JWT Context Leakage vulnerability FIXED');
    console.log('✅ auth.uid() function working correctly');
    console.log('✅ Cross-tenant isolation verified');
    console.log('✅ Connection pool cleanup verified');
    console.log('✅ Concurrent operations verified');
    console.log('');
    console.log('🔒 PRODUCTION DEPLOYMENT IS NOW SAFE! 🔒');
  } else {
    console.log('🚨 SECURITY TESTS FAILED! 🚨');
    console.log('❌ Production deployment is still UNSAFE');
    console.log('❌ Security vulnerabilities still exist');
  }
  console.log('==================================================');
  
  return allTestsPassed;
}

// Run the tests
runSecurityVerificationTests()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('🚨 CRITICAL ERROR during security testing:', error);
    process.exit(1);
  });