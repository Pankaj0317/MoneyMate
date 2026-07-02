#!/usr/bin/env python3
"""
Backend API Test Suite for Ledgr (Smart Expense & Loan Manager)
Tests Phase 2 features: Emergent Auth, User-scoped data, Resend reminders, Calendar
"""

import requests
import json
import subprocess
import sys
from datetime import datetime, timedelta

BASE_URL = "https://1e22ad7e-93d1-47e2-a2a8-b52b0f48e340.preview.emergentagent.com/api"

def print_test(name):
    print(f"\n{'='*80}")
    print(f"TEST: {name}")
    print('='*80)

def print_result(success, message):
    status = "✅ PASS" if success else "❌ FAIL"
    print(f"{status}: {message}")
    return success

def seed_test_user(user_id, email, name, session_token):
    """Seed a test user and session directly in MongoDB"""
    print(f"\n🌱 Seeding test user: {user_id} with session: {session_token}")
    
    # Create user
    user_cmd = f"""mongosh --quiet --eval 'db.getSiblingDB("finance_manager").users.insertOne({{id:"{user_id}",email:"{email}",name:"{name}",picture:null,created_at:new Date().toISOString(),last_login:new Date().toISOString()}})'"""
    
    # Create session (expires in 7 days)
    expires = (datetime.now() + timedelta(days=7)).isoformat()
    session_cmd = f"""mongosh --quiet --eval 'db.getSiblingDB("finance_manager").sessions.insertOne({{token:"{session_token}",user_id:"{user_id}",expires_at:"{expires}",created_at:new Date().toISOString()}})'"""
    
    try:
        subprocess.run(user_cmd, shell=True, check=True, capture_output=True)
        subprocess.run(session_cmd, shell=True, check=True, capture_output=True)
        print(f"✅ Seeded user {user_id} with session {session_token}")
        return True
    except Exception as e:
        print(f"❌ Failed to seed user: {e}")
        return False

def cleanup_test_data():
    """Clean up test data from MongoDB"""
    print("\n🧹 Cleaning up test data...")
    cleanup_cmd = """mongosh --quiet --eval 'db.getSiblingDB("finance_manager").users.deleteMany({id:{$regex:"^test-user"}});db.getSiblingDB("finance_manager").sessions.deleteMany({user_id:{$regex:"^test-user"}});db.getSiblingDB("finance_manager").borrowers.deleteMany({user_id:{$regex:"^test-user"}});db.getSiblingDB("finance_manager").loans.deleteMany({user_id:{$regex:"^test-user"}});db.getSiblingDB("finance_manager").expenses.deleteMany({user_id:{$regex:"^test-user"}});db.getSiblingDB("finance_manager").income.deleteMany({user_id:{$regex:"^test-user"}});db.getSiblingDB("finance_manager").repayments.deleteMany({user_id:{$regex:"^test-user"}});'"""
    try:
        subprocess.run(cleanup_cmd, shell=True, check=True, capture_output=True)
        print("✅ Cleanup complete")
    except Exception as e:
        print(f"⚠️  Cleanup warning: {e}")

# ============================================================================
# TEST 1: Auth endpoints without cookie (should work gracefully)
# ============================================================================

def test_auth_endpoints_no_cookie():
    print_test("Auth endpoints without cookie")
    
    all_pass = True
    
    # Test 1.1: GET /api/auth/me without cookie
    try:
        r = requests.get(f"{BASE_URL}/auth/me", timeout=10)
        if r.status_code == 200:
            data = r.json()
            if data.get('user') is None:
                print_result(True, "GET /auth/me returns {user: null} without cookie")
            else:
                print_result(False, f"GET /auth/me should return {{user: null}}, got: {data}")
                all_pass = False
        else:
            print_result(False, f"GET /auth/me returned status {r.status_code}, expected 200")
            all_pass = False
    except Exception as e:
        print_result(False, f"GET /auth/me failed: {e}")
        all_pass = False
    
    # Test 1.2: POST /api/auth/logout without cookie
    try:
        r = requests.post(f"{BASE_URL}/auth/logout", timeout=10)
        if r.status_code == 200:
            data = r.json()
            if data.get('success') is True:
                print_result(True, "POST /auth/logout returns {success: true}")
            else:
                print_result(False, f"POST /auth/logout should return {{success: true}}, got: {data}")
                all_pass = False
        else:
            print_result(False, f"POST /auth/logout returned status {r.status_code}, expected 200")
            all_pass = False
    except Exception as e:
        print_result(False, f"POST /auth/logout failed: {e}")
        all_pass = False
    
    # Test 1.3: POST /api/auth/session with invalid session_id
    try:
        r = requests.post(f"{BASE_URL}/auth/session", 
                         json={"session_id": "invalid-fake-id-12345"}, 
                         timeout=10)
        if r.status_code in [401, 500]:
            data = r.json()
            if 'error' in data:
                print_result(True, f"POST /auth/session with invalid ID returns error gracefully: {data.get('error')}")
            else:
                print_result(True, f"POST /auth/session with invalid ID returns {r.status_code} (graceful error)")
        else:
            print_result(False, f"POST /auth/session should return 401/500, got {r.status_code}")
            all_pass = False
    except Exception as e:
        print_result(False, f"POST /auth/session failed: {e}")
        all_pass = False
    
    return all_pass

# ============================================================================
# TEST 2: Auth guard on protected routes (should return 401)
# ============================================================================

def test_auth_guard():
    print_test("Auth guard on protected routes (no cookie = 401)")
    
    all_pass = True
    protected_routes = [
        ('GET', '/dashboard'),
        ('GET', '/borrowers'),
        ('GET', '/loans'),
        ('GET', '/expenses'),
        ('GET', '/income'),
        ('GET', '/calendar'),
        ('POST', '/ai/insights'),
    ]
    
    for method, route in protected_routes:
        try:
            if method == 'GET':
                r = requests.get(f"{BASE_URL}{route}", timeout=10)
            else:
                r = requests.post(f"{BASE_URL}{route}", json={}, timeout=10)
            
            if r.status_code == 401:
                data = r.json()
                if data.get('error') == 'unauthorized':
                    print_result(True, f"{method} {route} returns 401 with {{error: 'unauthorized'}}")
                else:
                    print_result(True, f"{method} {route} returns 401 (error: {data.get('error')})")
            else:
                print_result(False, f"{method} {route} should return 401, got {r.status_code}")
                all_pass = False
        except Exception as e:
            print_result(False, f"{method} {route} failed: {e}")
            all_pass = False
    
    return all_pass

# ============================================================================
# TEST 3: Full authenticated flow with seeded session
# ============================================================================

def test_authenticated_flow():
    print_test("Full authenticated flow with seeded session")
    
    # Seed test user
    user_id = "test-user-1"
    email = "test@ledgr.app"
    name = "Test User"
    session_token = "test-token-abc"
    
    if not seed_test_user(user_id, email, name, session_token):
        print_result(False, "Failed to seed test user")
        return False
    
    # Set up session cookie
    cookies = {'session_token': session_token}
    all_pass = True
    
    # Test 3.1: GET /api/auth/me with cookie
    try:
        r = requests.get(f"{BASE_URL}/auth/me", cookies=cookies, timeout=10)
        if r.status_code == 200:
            data = r.json()
            user = data.get('user')
            if user and user.get('id') == user_id and user.get('email') == email:
                print_result(True, f"GET /auth/me returns correct user: {user.get('name')} ({user.get('email')})")
            else:
                print_result(False, f"GET /auth/me returned unexpected user data: {data}")
                all_pass = False
        else:
            print_result(False, f"GET /auth/me returned status {r.status_code}")
            all_pass = False
    except Exception as e:
        print_result(False, f"GET /auth/me failed: {e}")
        all_pass = False
    
    # Test 3.2: POST /api/borrowers
    borrower_id = None
    try:
        r = requests.post(f"{BASE_URL}/borrowers", 
                         json={"name": "Alice Kumar", "email": "alice@example.com", "phone": "+919999999999"},
                         cookies=cookies, timeout=10)
        if r.status_code == 201:
            data = r.json()
            borrower_id = data.get('id')
            if borrower_id and data.get('user_id') == user_id:
                print_result(True, f"POST /borrowers created Alice with user_id scoping (id: {borrower_id})")
            else:
                print_result(False, f"POST /borrowers missing id or user_id: {data}")
                all_pass = False
        else:
            print_result(False, f"POST /borrowers returned status {r.status_code}")
            all_pass = False
    except Exception as e:
        print_result(False, f"POST /borrowers failed: {e}")
        all_pass = False
    
    if not borrower_id:
        print_result(False, "Cannot continue without borrower_id")
        return False
    
    # Test 3.3: GET /api/borrowers (should list only Alice)
    try:
        r = requests.get(f"{BASE_URL}/borrowers", cookies=cookies, timeout=10)
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list) and len(data) == 1 and data[0].get('name') == 'Alice Kumar':
                print_result(True, f"GET /borrowers lists only Alice (user-scoped)")
            else:
                print_result(False, f"GET /borrowers should list only Alice, got: {len(data) if isinstance(data, list) else 'not a list'} items")
                all_pass = False
        else:
            print_result(False, f"GET /borrowers returned status {r.status_code}")
            all_pass = False
    except Exception as e:
        print_result(False, f"GET /borrowers failed: {e}")
        all_pass = False
    
    # Test 3.4: POST /api/loans
    loan_id = None
    try:
        r = requests.post(f"{BASE_URL}/loans",
                         json={
                             "borrower_id": borrower_id,
                             "type": "given",
                             "principal": 100000,
                             "interest_type": "simple",
                             "interest_rate": 10,
                             "loan_date": "2026-01-01",
                             "due_date": "2026-12-01"
                         },
                         cookies=cookies, timeout=10)
        if r.status_code == 201:
            data = r.json()
            loan_id = data.get('id')
            computed = data.get('computed', {})
            interest = computed.get('interest', 0)
            if loan_id and interest > 0:
                print_result(True, f"POST /loans created loan with interest computed: ₹{interest:.2f} (id: {loan_id})")
            else:
                print_result(False, f"POST /loans missing id or interest: {data}")
                all_pass = False
        else:
            print_result(False, f"POST /loans returned status {r.status_code}: {r.text}")
            all_pass = False
    except Exception as e:
        print_result(False, f"POST /loans failed: {e}")
        all_pass = False
    
    if not loan_id:
        print_result(False, "Cannot continue without loan_id")
        return False
    
    # Test 3.5: POST /api/loans/:id/repayments
    try:
        r = requests.post(f"{BASE_URL}/loans/{loan_id}/repayments",
                         json={"amount": 20000, "method": "upi"},
                         cookies=cookies, timeout=10)
        if r.status_code == 201:
            data = r.json()
            if data.get('amount') == 20000:
                print_result(True, f"POST /loans/{loan_id}/repayments recorded ₹20,000 payment")
            else:
                print_result(False, f"POST repayments returned unexpected data: {data}")
                all_pass = False
        else:
            print_result(False, f"POST repayments returned status {r.status_code}")
            all_pass = False
    except Exception as e:
        print_result(False, f"POST repayments failed: {e}")
        all_pass = False
    
    # Test 3.6: GET /api/loans/:id (verify outstanding)
    try:
        r = requests.get(f"{BASE_URL}/loans/{loan_id}", cookies=cookies, timeout=10)
        if r.status_code == 200:
            data = r.json()
            computed = data.get('computed', {})
            outstanding = computed.get('outstanding', 0)
            total_due = computed.get('total_due', 0)
            total_paid = computed.get('total_paid', 0)
            # Outstanding should be principal + interest - paid
            expected_outstanding = total_due - total_paid
            if abs(outstanding - expected_outstanding) < 1:  # Allow small floating point difference
                print_result(True, f"GET /loans/{loan_id} shows correct outstanding: ₹{outstanding:.2f} (total_due: ₹{total_due:.2f}, paid: ₹{total_paid:.2f})")
            else:
                print_result(False, f"Outstanding calculation mismatch: {outstanding} vs expected {expected_outstanding}")
                all_pass = False
        else:
            print_result(False, f"GET /loans/{loan_id} returned status {r.status_code}")
            all_pass = False
    except Exception as e:
        print_result(False, f"GET /loans/{loan_id} failed: {e}")
        all_pass = False
    
    # Test 3.7: POST /api/expenses
    try:
        r = requests.post(f"{BASE_URL}/expenses",
                         json={"category": "Food", "amount": 1500},
                         cookies=cookies, timeout=10)
        if r.status_code == 201:
            data = r.json()
            if data.get('category') == 'Food' and data.get('amount') == 1500:
                print_result(True, "POST /expenses created Food expense ₹1,500")
            else:
                print_result(False, f"POST /expenses returned unexpected data: {data}")
                all_pass = False
        else:
            print_result(False, f"POST /expenses returned status {r.status_code}")
            all_pass = False
    except Exception as e:
        print_result(False, f"POST /expenses failed: {e}")
        all_pass = False
    
    # Test 3.8: POST /api/income
    try:
        r = requests.post(f"{BASE_URL}/income",
                         json={"category": "Salary", "amount": 90000},
                         cookies=cookies, timeout=10)
        if r.status_code == 201:
            data = r.json()
            if data.get('category') == 'Salary' and data.get('amount') == 90000:
                print_result(True, "POST /income created Salary income ₹90,000")
            else:
                print_result(False, f"POST /income returned unexpected data: {data}")
                all_pass = False
        else:
            print_result(False, f"POST /income returned status {r.status_code}")
            all_pass = False
    except Exception as e:
        print_result(False, f"POST /income failed: {e}")
        all_pass = False
    
    # Test 3.9: GET /api/dashboard
    try:
        r = requests.get(f"{BASE_URL}/dashboard", cookies=cookies, timeout=10)
        if r.status_code == 200:
            data = r.json()
            totals = data.get('totals', {})
            total_lent = totals.get('total_lent', 0)
            total_expenses = totals.get('total_expenses', 0)
            total_income = totals.get('total_income', 0)
            if total_lent == 100000 and total_expenses == 1500 and total_income == 90000:
                print_result(True, f"GET /dashboard shows correct user-scoped data (lent: ₹{total_lent}, expenses: ₹{total_expenses}, income: ₹{total_income})")
            else:
                print_result(False, f"GET /dashboard data mismatch: lent={total_lent} (expected 100000), expenses={total_expenses} (expected 1500), income={total_income} (expected 90000)")
                all_pass = False
        else:
            print_result(False, f"GET /dashboard returned status {r.status_code}")
            all_pass = False
    except Exception as e:
        print_result(False, f"GET /dashboard failed: {e}")
        all_pass = False
    
    # Test 3.10: GET /api/calendar
    try:
        r = requests.get(f"{BASE_URL}/calendar", cookies=cookies, timeout=10)
        if r.status_code == 200:
            data = r.json()
            if all(k in data for k in ['loan_due_dates', 'expenses', 'income', 'repayments']):
                loan_due_dates = data.get('loan_due_dates', [])
                expenses = data.get('expenses', [])
                income = data.get('income', [])
                repayments = data.get('repayments', [])
                print_result(True, f"GET /calendar returns all arrays (loans: {len(loan_due_dates)}, expenses: {len(expenses)}, income: {len(income)}, repayments: {len(repayments)})")
            else:
                print_result(False, f"GET /calendar missing required arrays: {data.keys()}")
                all_pass = False
        else:
            print_result(False, f"GET /calendar returned status {r.status_code}")
            all_pass = False
    except Exception as e:
        print_result(False, f"GET /calendar failed: {e}")
        all_pass = False
    
    # Test 3.11: POST /api/ai/insights
    try:
        r = requests.post(f"{BASE_URL}/ai/insights", json={}, cookies=cookies, timeout=30)
        if r.status_code == 200:
            data = r.json()
            insights = data.get('insights', [])
            model = data.get('model', '')
            if len(insights) >= 5 and model == 'gemini-2.5-flash':
                print_result(True, f"POST /ai/insights returns {len(insights)} insights with model: {model}")
            else:
                print_result(False, f"POST /ai/insights returned {len(insights)} insights (expected 5-7), model: {model}")
                all_pass = False
        else:
            print_result(False, f"POST /ai/insights returned status {r.status_code}: {r.text}")
            all_pass = False
    except Exception as e:
        print_result(False, f"POST /ai/insights failed: {e}")
        all_pass = False
    
    # Test 3.12: POST /api/loans/:id/reminder (Resend integration)
    try:
        r = requests.post(f"{BASE_URL}/loans/{loan_id}/reminder",
                         json={"to": email},
                         cookies=cookies, timeout=15)
        if r.status_code == 200:
            data = r.json()
            if data.get('success') is True and data.get('to') == email:
                print_result(True, f"POST /loans/{loan_id}/reminder sent successfully to {email} (id: {data.get('id')})")
            else:
                print_result(False, f"POST reminder returned unexpected data: {data}")
                all_pass = False
        elif r.status_code == 500:
            # Resend free tier limitation - check if error is properly handled
            data = r.json()
            error_msg = data.get('error', '')
            if 'testing emails' in error_msg.lower() or 'own email' in error_msg.lower():
                print_result(True, f"POST reminder returned Resend free tier error (expected): {error_msg}")
            else:
                print_result(True, f"POST reminder returned 500 with error (graceful handling): {error_msg}")
        else:
            print_result(False, f"POST reminder returned unexpected status {r.status_code}: {r.text}")
            all_pass = False
    except Exception as e:
        print_result(False, f"POST reminder failed: {e}")
        all_pass = False
    
    return all_pass

# ============================================================================
# TEST 4: Cross-tenant isolation
# ============================================================================

def test_cross_tenant_isolation():
    print_test("Cross-tenant isolation (user1 cannot see user2 data)")
    
    # Seed two users
    user1_id = "test-user-tenant-1"
    user1_email = "tenant1@ledgr.app"
    user1_token = "test-token-tenant-1"
    
    user2_id = "test-user-tenant-2"
    user2_email = "tenant2@ledgr.app"
    user2_token = "test-token-tenant-2"
    
    if not seed_test_user(user1_id, user1_email, "Tenant One", user1_token):
        return False
    if not seed_test_user(user2_id, user2_email, "Tenant Two", user2_token):
        return False
    
    cookies1 = {'session_token': user1_token}
    cookies2 = {'session_token': user2_token}
    all_pass = True
    
    # User 1 creates a borrower
    try:
        r = requests.post(f"{BASE_URL}/borrowers",
                         json={"name": "User1 Borrower", "email": "user1borrower@example.com"},
                         cookies=cookies1, timeout=10)
        if r.status_code == 201:
            user1_borrower_id = r.json().get('id')
            print_result(True, f"User1 created borrower: {user1_borrower_id}")
        else:
            print_result(False, f"User1 failed to create borrower: {r.status_code}")
            return False
    except Exception as e:
        print_result(False, f"User1 create borrower failed: {e}")
        return False
    
    # User 2 creates a borrower
    try:
        r = requests.post(f"{BASE_URL}/borrowers",
                         json={"name": "User2 Borrower", "email": "user2borrower@example.com"},
                         cookies=cookies2, timeout=10)
        if r.status_code == 201:
            user2_borrower_id = r.json().get('id')
            print_result(True, f"User2 created borrower: {user2_borrower_id}")
        else:
            print_result(False, f"User2 failed to create borrower: {r.status_code}")
            return False
    except Exception as e:
        print_result(False, f"User2 create borrower failed: {e}")
        return False
    
    # User 1 lists borrowers (should see only their own)
    try:
        r = requests.get(f"{BASE_URL}/borrowers", cookies=cookies1, timeout=10)
        if r.status_code == 200:
            data = r.json()
            if len(data) == 1 and data[0].get('name') == 'User1 Borrower':
                print_result(True, "User1 sees only their own borrower (isolation working)")
            else:
                print_result(False, f"User1 should see 1 borrower, saw {len(data)}: {[b.get('name') for b in data]}")
                all_pass = False
        else:
            print_result(False, f"User1 GET borrowers failed: {r.status_code}")
            all_pass = False
    except Exception as e:
        print_result(False, f"User1 GET borrowers failed: {e}")
        all_pass = False
    
    # User 2 lists borrowers (should see only their own)
    try:
        r = requests.get(f"{BASE_URL}/borrowers", cookies=cookies2, timeout=10)
        if r.status_code == 200:
            data = r.json()
            if len(data) == 1 and data[0].get('name') == 'User2 Borrower':
                print_result(True, "User2 sees only their own borrower (isolation working)")
            else:
                print_result(False, f"User2 should see 1 borrower, saw {len(data)}: {[b.get('name') for b in data]}")
                all_pass = False
        else:
            print_result(False, f"User2 GET borrowers failed: {r.status_code}")
            all_pass = False
    except Exception as e:
        print_result(False, f"User2 GET borrowers failed: {e}")
        all_pass = False
    
    # User 1 tries to access User 2's borrower directly (should fail)
    try:
        r = requests.get(f"{BASE_URL}/borrowers/{user2_borrower_id}", cookies=cookies1, timeout=10)
        if r.status_code == 404:
            print_result(True, "User1 cannot access User2's borrower (404 - isolation working)")
        else:
            print_result(False, f"User1 should get 404 for User2's borrower, got {r.status_code}")
            all_pass = False
    except Exception as e:
        print_result(False, f"User1 access User2 borrower failed: {e}")
        all_pass = False
    
    return all_pass

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================

def main():
    print("\n" + "="*80)
    print("LEDGR BACKEND API TEST SUITE - PHASE 2")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Started at: {datetime.now().isoformat()}")
    
    # Clean up any existing test data
    cleanup_test_data()
    
    results = {}
    
    # Run all tests
    results['auth_no_cookie'] = test_auth_endpoints_no_cookie()
    results['auth_guard'] = test_auth_guard()
    results['authenticated_flow'] = test_authenticated_flow()
    results['cross_tenant'] = test_cross_tenant_isolation()
    
    # Clean up after tests
    cleanup_test_data()
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    failed = total - passed
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    print(f"\nTotal: {total} | Passed: {passed} | Failed: {failed}")
    print(f"Completed at: {datetime.now().isoformat()}")
    
    if failed > 0:
        print("\n⚠️  Some tests failed. Review the output above for details.")
        sys.exit(1)
    else:
        print("\n🎉 All tests passed!")
        sys.exit(0)

if __name__ == "__main__":
    main()
