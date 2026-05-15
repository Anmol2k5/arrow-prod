import os
from pathlib import Path
from PyQt6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit, 
    QPushButton, QScrollArea, QWidget, QFormLayout, QFrame
)
from PyQt6.QtCore import Qt
from config import cfg

class SettingsDialog(QDialog):
    """Dialog for managing API keys and provider settings."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Clicky Settings — API Keys")
        self.setMinimumSize(500, 600)
        self.setStyleSheet("""
            QDialog { background: #0e1014; color: #e8eaed; }
            QLabel { color: #e8eaed; font-size: 13px; }
            QLineEdit { 
                background: #1a1d22; border: 1px solid #2a2d33; 
                border-radius: 6px; padding: 8px; color: #e8eaed;
                font-family: 'Consolas', 'Monaco', monospace;
            }
            QLineEdit:focus { border-color: #1f6feb; }
            QPushButton {
                background: #1f6feb; color: white; border: none;
                padding: 10px 18px; border-radius: 8px;
                font-weight: 600; font-size: 13px;
            }
            QPushButton:hover { background: #2f7fff; }
            QPushButton#secondary {
                background: transparent; color: #a0a3a8;
                border: 1px solid #2a2d33;
            }
            QPushButton#secondary:hover { color: #e8eaed; border-color: #444; }
            QScrollArea { border: none; background: transparent; }
            QWidget#scroll_content { background: transparent; }
        """)

        self._build_ui()
        self._load_keys()

    def _build_ui(self):
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(24, 24, 24, 24)
        main_layout.setSpacing(20)

        title = QLabel("API Configurations")
        title.setStyleSheet("font-size: 20px; font-weight: 700; color: #fff;")
        main_layout.addWidget(title)

        subtitle = QLabel("Set your keys here to enable premium models. Changes are saved to .env.local")
        subtitle.setStyleSheet("color: #a0a3a8; margin-bottom: 10px;")
        subtitle.setWordWrap(True)
        main_layout.addWidget(subtitle)

        # Scroll area for many keys
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setObjectName("scroll_area")
        
        content = QWidget()
        content.setObjectName("scroll_content")
        form = QFormLayout(content)
        form.setVerticalSpacing(15)
        form.setLabelAlignment(Qt.AlignmentFlag.AlignRight)

        self._inputs = {}

        # LLM Sections
        self._add_section(form, "LLM PROVIDERS")
        self._add_key_field(form, "ANTHROPIC_API_KEY", "Anthropic (Claude)")
        self._add_key_field(form, "OPENAI_API_KEY", "OpenAI (GPT-4o)")
        self._add_key_field(form, "GOOGLE_API_KEY", "Google (Gemini)")
        self._add_key_field(form, "NVIDIA_API_KEY", "NVIDIA NIM")
        self._add_key_field(form, "GROQ_API_KEY", "Groq")
        self._add_key_field(form, "DEEPSEEK_API_KEY", "DeepSeek")
        self._add_key_field(form, "OPENROUTER_API_KEY", "OpenRouter")

        # Audio Section
        self._add_section(form, "SPEECH & SEARCH")
        self._add_key_field(form, "ELEVENLABS_API_KEY", "ElevenLabs TTS")
        self._add_key_field(form, "SARVAM_AI_API", "Sarvam AI TTS")
        self._add_key_field(form, "DEEPGRAM_API_KEY", "Deepgram STT")
        self._add_key_field(form, "TAVILY_API_KEY", "Tavily Search")

        scroll.setWidget(content)
        main_layout.addWidget(scroll)

        # Buttons
        btn_row = QHBoxLayout()
        btn_row.addStretch(1)
        
        cancel_btn = QPushButton("Cancel")
        cancel_btn.setObjectName("secondary")
        cancel_btn.clicked.connect(self.reject)
        btn_row.addWidget(cancel_btn)

        save_btn = QPushButton("Save & Restart App")
        save_btn.clicked.connect(self._on_save)
        btn_row.addWidget(save_btn)

        main_layout.addLayout(btn_row)

    def _add_section(self, form, title):
        label = QLabel(title)
        label.setStyleSheet("font-weight: 700; color: #1f6feb; margin-top: 10px; font-size: 11px; letter-spacing: 1px;")
        form.addRow(label)

    def _add_key_field(self, form, env_name, display_name):
        edit = QLineEdit()
        edit.setEchoMode(QLineEdit.EchoMode.Password)
        edit.setPlaceholderText("Paste key here...")
        self._inputs[env_name] = edit
        form.addRow(QLabel(display_name), edit)

    def _load_keys(self):
        # Load current values from os.environ (which includes .env loads)
        for env_name, edit in self._inputs.items():
            val = os.getenv(env_name) or ""
            edit.setText(val)

    def _on_save(self):
        new_keys = {name: edit.text().strip() for name, edit in self._inputs.items()}
        
        # We save to .env.local to avoid overwriting the main .env which might have comments
        env_path = Path(__file__).parent.parent / ".env.local"
        
        lines = []
        if env_path.exists():
            existing_lines = env_path.read_text().splitlines()
            # Keep lines that aren't in our new_keys set
            for line in existing_lines:
                if "=" in line:
                    key = line.split("=")[0].strip()
                    if key not in new_keys:
                        lines.append(line)
        
        for name, val in new_keys.items():
            if val:
                lines.append(f"{name}={val}")
        
        try:
            env_path.write_text("\n".join(lines))
            self.accept()
            # Optionally trigger a restart notice
        except Exception as e:
            from PyQt6.QtWidgets import QMessageBox
            QMessageBox.critical(self, "Error", f"Failed to save .env.local: {e}")

def show_settings(parent=None):
    dlg = SettingsDialog(parent)
    return dlg.exec()
