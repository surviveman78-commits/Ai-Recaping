from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional

from worker.core.tts.models import (
    TTSGenerationRequest,
    TTSGenerationResult,
    TTSEngineCapabilities,
)

class TTSProvider(ABC):
    """
    Abstract base class for all TTS providers (Edge-TTS, VoxCPM2, etc.).
    """

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Returns the unique identifier for this provider (e.g. 'edge-tts', 'voxcpm2')."""
        pass

    @abstractmethod
    def get_capabilities(self) -> TTSEngineCapabilities:
        """Returns engine-specific capabilities and limits."""
        pass

    @abstractmethod
    def validate_request(self, request: TTSGenerationRequest) -> None:
        """
        Validates request parameters before synthesis begins.
        Raises TTSError if inputs are invalid.
        """
        pass

    @abstractmethod
    def generate(self, request: TTSGenerationRequest) -> TTSGenerationResult:
        """
        Synthesizes audio for the given text chunk.
        MUST measure and return the REAL audio duration of the resulting file.
        """
        pass

    def get_available_voices(self, language: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns list of supported voices for this provider."""
        return []
