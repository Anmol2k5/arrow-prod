import json
import sys
import wave
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PYDEPS = ROOT / "pydeps"
if str(PYDEPS) not in sys.path:
    sys.path.insert(0, str(PYDEPS))

from riva.client import ASRService, AudioEncoding, Auth, RecognitionConfig  # type: ignore


CANARY_FUNCTION_ID = "b0e8b4a5-217c-40b7-9b96-17d84e666317"


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: nvidia_asr.py <wav_path> <api_key> [language_code]"}))
        return 1

    wav_path = Path(sys.argv[1])
    api_key = sys.argv[2].strip()
    language_code = sys.argv[3] if len(sys.argv) > 3 else "en-US"

    if not wav_path.exists():
      print(json.dumps({"ok": False, "error": f"WAV file not found: {wav_path}"}))
      return 1

    try:
        with wave.open(str(wav_path), "rb") as wav_file:
            sample_rate = wav_file.getframerate()
            channel_count = wav_file.getnchannels()
            audio_bytes = wav_file.readframes(wav_file.getnframes())

        auth = Auth(
            use_ssl=True,
            uri="grpc.nvcf.nvidia.com:443",
            metadata_args=[
                ["function-id", CANARY_FUNCTION_ID],
                ["authorization", f"Bearer {api_key}"],
            ],
        )

        asr_service = ASRService(auth)
        config = RecognitionConfig(
            encoding=AudioEncoding.LINEAR_PCM,
            sample_rate_hertz=sample_rate,
            audio_channel_count=channel_count,
            language_code=language_code,
            max_alternatives=1,
            enable_automatic_punctuation=True,
            verbatim_transcripts=False,
        )

        response = asr_service.offline_recognize(audio_bytes, config)

        transcript_parts = []
        for result in response.results:
            if result.alternatives:
                transcript_parts.append(result.alternatives[0].transcript)

        transcript = " ".join(part.strip() for part in transcript_parts if part.strip()).strip()
        print(json.dumps({"ok": True, "text": transcript}))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
