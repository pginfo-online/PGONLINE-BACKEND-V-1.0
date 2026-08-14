# Implementation Plan: SMS OTP Auto-fill (Fixed DLT Template)

This updated plan provides the industry-standard approach for SMS OTP auto-fill **without modifying your existing Indian DLT SMS template**.

---

## 1. Industry Standard Options Compared

| Feature | Option 1: **Google SMS User Consent API** *(Recommended)* | Option 2: **iOS QuickType `oneTimeCode`** | Option 3: **SMS Retriever (App Hash)** |
| :--- | :--- | :--- | :--- |
| **Requires DLT Template Edit?** | ❌ **NO** (Works with your existing DLT template) | ❌ **NO** (Works out of the box) | ⚠️ **YES** (Requires 11-char App Hash) |
| **User Experience** | Native 1-tap bottom sheet ("Allow PGinfo to read code 1234") | QuickType bar above keyboard ("From Messages: 1234") | Fully automatic 0-tap fill |
| **Permissions Needed?** | ❌ **NO** (`READ_SMS` permission not required) | ❌ **NO** | ❌ **NO** |
| **DLT Compliance** | 💯 100% TRAI DLT Compatible | 💯 100% TRAI DLT Compatible | Requires TRAI DLT re-approval |

---

## 2. Proposed Implementation Strategy

### Strategy for Android: **Google SMS User Consent API**
Using `@react-native-otp-verify/otp-verify` (or `@twotalltotems/react-native-otp-input`), the app calls `startUserConsent()` when the OTP screen loads:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. App sends OTP via existing DLT template                             │
│     "Dear Customer,1234 is your verification code -PNGOTP"              │
│                                                                         │
│  2. Android Play Services detects SMS & shows system prompt:             │
│     ┌─────────────────────────────────────────────────────────────┐     │
│     │  Allow PGinfo to read the verification code below?          │     │
│     │  Code: 1234                                                 │     │
│     │  [ Cancel ]                                   [ ALLOW ] ◄───┼─► Tap
│     └─────────────────────────────────────────────────────────────┘     │
│                                                                         │
│  3. Code "1234" is automatically populated into OtpInput.js             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Strategy for iOS: **Native Keyboard `oneTimeCode`**
In [`OtpInput.js`](file:///c:/Users/ADMIN/Desktop/2026/june/PGINFO-ONLINE/pgInfoonline-v-1.0/mobile/src/components/ui/OtpInput.js), add `textContentType="oneTimeCode"` to the input.
When SMS arrives, iOS QuickType bar displays: `From Messages: 1234`. Tapping it populates the 4 digits automatically.

---

## 3. Detailed Technical Steps

### Component 1: `OtpInput.js` UI Overlay & Props
- Wrap the inputs so that native autofill (which pastes the full 4 digits into the focused input) correctly propagates `1234` across all 4 visual boxes.
- Add `textContentType="oneTimeCode"` for iOS.
- Add `autoComplete="sms-otp"` for Android Gboard.

### Component 2: `AuthScreen.js` SMS User Consent Hook
1. When step becomes `'otp'`, trigger `OtpVerify.startOtpUserConsent()`.
2. Add listener callback:
   ```js
   useEffect(() => {
     if (step === 'otp') {
       OtpVerify.startOtpUserConsent()
         .then(() => OtpVerify.addListener(handleSmsReceived))
         .catch(console.error);
     }
     return () => OtpVerify.removeListener();
   }, [step]);
   ```
3. Parse the 4-digit code using regex `/(\d{4})/` and set `setOtp(code)`.

---

## 4. Verification Plan

### Manual Verification
- **Android**: Trigger OTP -> Observe Google Play Services bottom prompt -> Tap "Allow" -> Verify 4-digit code populates.
- **iOS**: Trigger OTP -> Observe keyboard bar prompt "From Messages" -> Tap prompt -> Verify 4-digit code populates.































Http API
Developer  Http API
Http API
SMS Api
SMS Api allows you to integrate our sms service to your own web based / stand alone applications.

http://sms.allcloud.in/api/smsapi?key=Account key&route=Route&sender=Sender id&number=Number(s)&sms=Message&templateid=DLT_Templateid
Description
#	Parameter	Description	Example
1	key	Your account API key	10fa0d573d632725421808674378f487
2	sender	Sender id	ALERTS
3	number	Destination numbers	99XXXXXXXX,98XXXXXXXX
4	route	Route you want to send SMS ( Promotional - 1, Transactional - 2, Optin - 3, Trans OTP - 4, Promo DND - 5, Whatsapp - 6, International - 7)	2
5	sms	SMS content (Url encoded)	Hello+user
6	templateid	DLT Template ID	123XXXXXXXXXXXXXXXX
* All special character included content should be in urlencode format.
Error Codes
101 : Invalid user
102 : Invalid sender ID
103 : Invalid contact(s)
104 : Invalid route
105 : Invalid message
106 : Spam blocked
107 : Promotional block
108 : Low credits in the specified route
109 : Promotional route will be working from 9am to 8:45pm only
110 : Invalid DLT Template ID
* A numeric value other than these error codes is the unique message id for the sent slot. Keep this message id for delivery report.

Delivery Report Api
SMS Delivery Report Api allows you to get delivery report of a slot sent via Api as JSON format.

http://sms.allcloud.in/api/dlrapi?key=Account key&messageid=Unique id
Description
#	Parameter	Description	Example
1	key	Your account API key	10fa0d573d632725421808674378f487
2	messageid	Unique message id returned by SMS Api	987650
* Give the exact message id.
Error Codes
101 : Invalid user
110 : Invalid message id
* A successive api return a JSON file containing the sent destination numbers with delivery report

Sample JSON will be like
[{"number":"number 1","status":"status 1","time":"time 1"},{"number":"number 2","status":"status 2","time":"time 2"}]
Credits Check Api
Available credits Api allows you to get currently available credits of a given route.

http://sms.allcloud.in/api/creditapi?key=Account key&route=Route
Description
#	Parameter	Description	Example
1	key	Your account API key	10fa0d573d632725421808674378f487
2	route	Route you want to check credits ( Promotional - 1, Transactional - 2, Optin - 3, Trans OTP - 4, Promo DND - 5, Whatsapp - 6, International - 7)	2
* Give the exact route id.
Error Codes
101 : Invalid user
104 : Invalid route
* A successive api return a JSON file containing the route name and credits

Sample JSON will be like
{"Route","Route","Credits","Credits"}
































DLT ERROR CODES :



DLT Error Code
Messageing  DLT Error Code
DLT Error Code

25
 records per page
Search : 
Search...
#	Error Code	Status	Description
1	001	Invalid Number	
2	002	Absent Subscriber	
3	003	Memory Capacity Exceeded	
4	004	Mobile Equipment Error	
5	005	Network Error	
6	006	Barring	
7	007	Invalid Sender ID	
8	008	Dropped	
9	009	NDNC Failed	
10	100	Misc. Error	
11	110	EC_ENTITY_BLOCKED_BY_DLT	
12	111	EC_TEMPLATE_BLOCKED_BY_DLT	
13	111	Entity not registered	
14	112	EC_ENTITY_NOT_FOUND	
15	112	Entity Inactive	
16	113	EC_ENTITY_NOT_REGISTERED	
17	114	Invalid Telemarketer	
18	114	EC_ENTITY_INACTIVE	
19	115	CLI Mismatch with Template	
20	116	EC_INVALID_ENTITY_ID	
21	116	Header Inactive	
22	117	EC_ENTITY_ID_NOT_ALLOWED_FOR_TM	
23	117	Header Blacklisted	
24	118	EC_TELEMARKETER_NOT_REGISTERED	
25	118	Template not found