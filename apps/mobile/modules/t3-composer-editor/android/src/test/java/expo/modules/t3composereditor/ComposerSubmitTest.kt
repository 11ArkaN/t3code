package expo.modules.t3composereditor

import android.text.InputType
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.InputDeviceBuilder

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], manifest = Config.NONE)
class ComposerSubmitTest {
  private val sends = mutableListOf<Boolean>()
  private val recordSend: (Boolean) -> Unit = { alternate -> sends += alternate }
  private val editor = SelectionAwareEditText(RuntimeEnvironment.getApplication()).apply {
    inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
    submitEnabled = true
    submitListener = recordSend
  }

  private val hardwareKeyboard = keyboard(1)

  private fun keyboard(id: Int, type: Int = InputDevice.KEYBOARD_TYPE_ALPHABETIC): InputDevice =
    InputDeviceBuilder.newBuilder()
      .setId(id)
      .setSources(InputDevice.SOURCE_KEYBOARD)
      .setKeyboardType(type)
      .build()

  private fun pressReturn(
    metaState: Int = 0,
    device: InputDevice? = hardwareKeyboard,
    repeatCount: Int = 0,
    flags: Int = 0
  ) {
    val event = KeyEvent(
      0,
      0,
      KeyEvent.ACTION_DOWN,
      KeyEvent.KEYCODE_ENTER,
      repeatCount,
      metaState,
      device?.id ?: UNKNOWN_DEVICE,
      0,
      flags,
    )
    // Robolectric's getDevice() reads the event's shadow, not the InputManager device list.
    shadowOf(event).setDevice(device)
    editor.onKeyDown(KeyEvent.KEYCODE_ENTER, event)
  }

  @Test
  fun sendBehaviorSendsOnReturnAndInsertsANewlineOnShiftReturn() {
    pressReturn()
    pressReturn(KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON)
    pressReturn(KeyEvent.META_SHIFT_ON or KeyEvent.META_SHIFT_LEFT_ON)

    assertEquals(listOf(false, true), sends)
    assertEquals("\n", editor.text.toString())
  }

  @Test
  fun newlineBehaviorSendsOnlyWithCtrl() {
    editor.returnSends = false

    pressReturn()
    pressReturn(KeyEvent.META_CTRL_ON)
    pressReturn(KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON)

    assertEquals(listOf(false, true), sends)
    assertEquals("\n", editor.text.toString())
  }

  @Test
  fun onScreenKeyboardReturnInsertsANewline() {
    pressReturn(device = keyboard(KeyCharacterMap.VIRTUAL_KEYBOARD))
    // An IME can send device 0 without FLAG_SOFT_KEYBOARD. On phones that ID is the built-in
    // "keyboard", a key-only device such as the fingerprint sensor.
    pressReturn(device = keyboard(0, InputDevice.KEYBOARD_TYPE_NON_ALPHABETIC))
    pressReturn(device = null)
    pressReturn(flags = KeyEvent.FLAG_SOFT_KEYBOARD)

    assertEquals(emptyList<Boolean>(), sends)
    assertEquals("\n\n\n\n", editor.text.toString())
  }

  @Test
  fun heldReturnSendsOnce() {
    pressReturn()
    pressReturn(repeatCount = 1)
    pressReturn(repeatCount = 2)

    assertEquals(listOf(false), sends)
    assertEquals("", editor.text.toString())
  }

  @Test
  fun returnNeverSendsFromAComposerThatCannotSubmit() {
    editor.submitListener = null
    pressReturn()
    assertEquals("\n", editor.text.toString())
    editor.submitListener = recordSend

    editor.submitEnabled = false
    pressReturn()
    editor.submitEnabled = true

    editor.readOnly = true
    pressReturn()
    editor.readOnly = false

    editor.isEnabled = false
    pressReturn()

    assertEquals(emptyList<Boolean>(), sends)
  }

  private companion object {
    const val UNKNOWN_DEVICE = 99
  }
}
