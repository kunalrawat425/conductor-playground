package expo.modules.smsconsent

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import com.google.android.gms.auth.api.phone.SmsRetriever
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Status
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * SMS User Consent (no SMS permission needed): while the OTP step is open, Android offers the next SMS that holds a code;
 * if the buyer taps Allow, the 6-digit code goes to JS ("onCode"). Listening stops by itself after 5 minutes ("onTimeout").
 */
class SmsConsentModule : Module() {
  private val REQ = 4712
  private var receiver: BroadcastReceiver? = null
  private val context: Context get() = requireNotNull(appContext.reactContext)

  override fun definition() = ModuleDefinition {
    Name("SmsConsent")
    Events("onCode", "onTimeout")

    Function("start") {
      stopListening()
      SmsRetriever.getClient(context).startSmsUserConsent(null)
      val r = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
          if (intent.action != SmsRetriever.SMS_RETRIEVED_ACTION) return
          val extras = intent.extras ?: return
          @Suppress("DEPRECATION") val status = extras.get(SmsRetriever.EXTRA_STATUS) as? Status ?: return
          when (status.statusCode) {
            CommonStatusCodes.SUCCESS -> {
              @Suppress("DEPRECATION") val consent = extras.getParcelable<Intent>(SmsRetriever.EXTRA_CONSENT_INTENT) ?: return
              try { appContext.currentActivity?.startActivityForResult(consent, REQ) } catch (_: Exception) {}
            }
            CommonStatusCodes.TIMEOUT -> { sendEvent("onTimeout", mapOf<String, Any>()); stopListening() }
          }
        }
      }
      val filter = IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION)
      if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(r, filter, SmsRetriever.SEND_PERMISSION, null, Context.RECEIVER_EXPORTED)
      else context.registerReceiver(r, filter, SmsRetriever.SEND_PERMISSION, null)
      receiver = r
    }

    Function("stop") { stopListening() }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQ) return@OnActivityResult
      if (payload.resultCode == Activity.RESULT_OK) {
        val msg = payload.data?.getStringExtra(SmsRetriever.EXTRA_SMS_MESSAGE) ?: ""
        val code = Regex("(?<!\\d)(\\d{6})(?!\\d)").find(msg)?.value
        if (code != null) sendEvent("onCode", mapOf("code" to code))
      }
      stopListening()
    }

    OnDestroy { stopListening() }
  }

  private fun stopListening() {
    receiver?.let { try { context.unregisterReceiver(it) } catch (_: Exception) {} }
    receiver = null
  }
}
