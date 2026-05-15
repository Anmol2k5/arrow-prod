"""
Gemini Multimodal Live API Integration.
Uses google-genai SDK for real-time WebSocket communication.

Handles:
  - Voice-to-voice streaming (16kHz PCM in, 24kHz PCM out)
  - Vision grounding via periodic screenshots
  - Tool calling for computer control (click, type, move, scroll, keypress)
"""

import asyncio
import base64
import traceback
from typing import Optional, Callable, Any

from google import genai
from google.genai import types

from config import cfg


def _build_live_tools() -> list[types.Tool]:
    """Declare computer control tools available to Gemini Live."""
    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name="click",
                    description="Click at screen coordinates (x, y) in logical pixels.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "x": types.Schema(
                                type=types.Type.INTEGER,
                                description="X coordinate in logical screen pixels",
                            ),
                            "y": types.Schema(
                                type=types.Type.INTEGER,
                                description="Y coordinate in logical screen pixels",
                            ),
                            "button": types.Schema(
                                type=types.Type.STRING,
                                enum=["left", "right", "middle"],
                                description="Mouse button to click",
                            ),
                            "clicks": types.Schema(
                                type=types.Type.INTEGER,
                                description="Number of clicks (1=single, 2=double)",
                            ),
                        },
                        required=["x", "y"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="type_text",
                    description="Type text into the currently focused field with full Unicode support.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "text": types.Schema(
                                type=types.Type.STRING,
                                description="Text to type (supports Unicode, emojis, etc.)",
                            ),
                        },
                        required=["text"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="move_to",
                    description="Move the mouse cursor to screen coordinates (x, y).",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "x": types.Schema(
                                type=types.Type.INTEGER,
                                description="X coordinate",
                            ),
                            "y": types.Schema(
                                type=types.Type.INTEGER,
                                description="Y coordinate",
                            ),
                            "duration": types.Schema(
                                type=types.Type.NUMBER,
                                description="Animation duration in seconds (default 0.3)",
                            ),
                        },
                        required=["x", "y"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="scroll",
                    description="Scroll at screen coordinates (x, y).",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "x": types.Schema(
                                type=types.Type.INTEGER,
                                description="X coordinate",
                            ),
                            "y": types.Schema(
                                type=types.Type.INTEGER,
                                description="Y coordinate",
                            ),
                            "clicks": types.Schema(
                                type=types.Type.INTEGER,
                                description="Number of scroll clicks (default 3)",
                            ),
                            "direction": types.Schema(
                                type=types.Type.STRING,
                                enum=["up", "down"],
                                description="Scroll direction",
                            ),
                        },
                        required=["x", "y"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="press_key",
                    description="Press a single keyboard key.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "key": types.Schema(
                                type=types.Type.STRING,
                                description="Key name (e.g. 'enter', 'escape', 'tab', 'space')",
                            ),
                        },
                        required=["key"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="hotkey",
                    description="Press a keyboard combination (e.g. ctrl+c).",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "keys": types.Schema(
                                type=types.Type.ARRAY,
                                items=types.Schema(type=types.Type.STRING),
                                description="List of key names to press together",
                            ),
                        },
                        required=["keys"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="open_app",
                    description="Launch a Windows application by path or name.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "path_or_name": types.Schema(
                                type=types.Type.STRING,
                                description="Application path (e.g. 'C:\\Program Files\\...') or name (e.g. 'notepad')",
                            ),
                        },
                        required=["path_or_name"],
                    ),
                ),
            ]
        ),
    ]


class GeminiLiveIntegration:
    """Manages a Gemini Multimodal Live WebSocket session.

    Usage:
        integration = GeminiLiveIntegration(
            api_key="...",
            on_audio_chunk=handle_audio,
            on_text_chunk=handle_text,
            on_tool_call=handle_tool,
            on_error=handle_error,
        )
        await integration.start(system_instruction="You are a helpful assistant.")
        await integration.send_audio(pcm_chunk)
        await integration.send_screen(image_b64)
        # ... receive loop runs automatically
        await integration.stop()
    """

    def __init__(
        self,
        api_key: str,
        on_audio_chunk: Optional[Callable[[bytes], None]] = None,
        on_text_chunk: Optional[Callable[[str], None]] = None,
        on_tool_call: Optional[Callable[[str, dict], None]] = None,
        on_error: Optional[Callable[[str], None]] = None,
    ):
        self._client = genai.Client(
            api_key=api_key,
            http_options={"api_version": "v1alpha"},
        )
        self._session = None
        self._model_id = "gemini-2.0-flash-exp"

        self.on_audio_chunk = on_audio_chunk
        self.on_text_chunk = on_text_chunk
        self.on_tool_call = on_tool_call
        self.on_error = on_error

        self._is_running = False
        self._receive_task: Optional[asyncio.Task] = None

    async def start(self, system_instruction: str = "", tools: Optional[List] = None):
        """Starts the Gemini Live session."""
        if self._is_running:
            return

        config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Puck",
                    ),
                ),
            ),
            system_instruction=types.Content(
                role="user",
                parts=[types.Part.from_text(text=system_instruction)],
            ),
            tools=_build_live_tools(),
        )

        try:
            self._session = await self._client.aio.live.connect(
                model=self._model_id,
                config=config,
            )
            self._is_running = True
            self._receive_task = asyncio.create_task(self._receive_loop())
            print("[GeminiLive] Session started.", flush=True)
        except Exception as e:
            err_msg = f"Failed to connect to Gemini Live: {e}"
            print(f"[GeminiLive] {err_msg}", flush=True)
            if self.on_error:
                self.on_error(err_msg)
            raise

    async def stop(self):
        """Tear down the Gemini Live session."""
        self._is_running = False

        if self._receive_task:
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass
            self._receive_task = None

        if self._session:
            try:
                await self._session.close()
            except Exception:
                pass
            self._session = None

        print("[GeminiLive] Session stopped.", flush=True)

    async def send_audio(self, pcm_data: bytes, end_of_turn: bool = False):
        """Stream 16kHz PCM16 audio from the microphone to Gemini.

        Args:
            pcm_data: Raw PCM16 bytes at 16kHz mono.
            end_of_turn: Set True when the user finishes speaking to signal
                         Gemini to generate a response.
        """
        if not self._is_running or not self._session:
            return

        try:
            content = types.Content(
                role="user",
                parts=[types.Part.from_bytes(data=pcm_data, mime_type="audio/pcm")],
            )
            await self._session.send(input=content, end_of_turn=end_of_turn)
        except Exception as e:
            print(f"[GeminiLive] Error sending audio: {e}", flush=True)

    async def send_screen(self, image_b64: str):
        """Send a base64-encoded JPEG screenshot for vision grounding.

        Args:
            image_b64: Base64 string of a JPEG image.
        """
        if not self._is_running or not self._session:
            return

        try:
            img_bytes = base64.b64decode(image_b64)
            content = types.Content(
                role="user",
                parts=[
                    types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg")
                ],
            )
            await self._session.send(input=content)
        except Exception as e:
            print(f"[GeminiLive] Error sending screen: {e}", flush=True)

    async def send_tool_result(self, function_call_id: str, result: Any):
        """Send a tool execution result back to Gemini.

        Args:
            function_call_id: The ID from the original function call.
            result: The result of the tool execution.
        """
        if not self._is_running or not self._session:
            return

        try:
            response_part = types.Part.from_function_response(
                name=function_call_id,
                response={"result": str(result)},
            )
            content = types.Content(role="tool", parts=[response_part])
            await self._session.send(input=content)
        except Exception as e:
            print(f"[GeminiLive] Error sending tool result: {e}", flush=True)

    async def _receive_loop(self):
        """Internal loop to process incoming messages from Gemini.

        Parses:
          - Audio chunks (inline_data with audio/* mime type)
          - Text responses
          - Function/tool calls for computer control
        """
        try:
            async for response in self._session.receive():
                if not self._is_running:
                    break

                if not response.candidates:
                    continue

                for candidate in response.candidates:
                    if not candidate.content or not candidate.content.parts:
                        continue

                    for part in candidate.content.parts:
                        # Audio chunk from Gemini
                        if part.inline_data and part.inline_data.data:
                            if self.on_audio_chunk:
                                self.on_audio_chunk(part.inline_data.data)

                        # Text response
                        elif part.text:
                            if self.on_text_chunk:
                                self.on_text_chunk(part.text)

                        # Tool/function call
                        elif part.function_call:
                            if self.on_tool_call:
                                func_name = part.function_call.name
                                func_args = {}
                                if part.function_call.args:
                                    func_args = dict(part.function_call.args)
                                self.on_tool_call(func_name, func_args)

        except asyncio.CancelledError:
            pass
        except Exception as e:
            if self._is_running:
                err_msg = f"Error in Gemini Live receive loop: {e}"
                print(f"[GeminiLive] {err_msg}", flush=True)
                traceback.print_exc()
                if self.on_error:
                    self.on_error(err_msg)
            self._is_running = False

    @property
    def is_running(self) -> bool:
        return self._is_running
