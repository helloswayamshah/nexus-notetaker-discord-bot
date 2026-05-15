import logging
from uuid import UUID
from datetime import datetime
from typing import Optional, List, Dict, Any

from sqlalchemy.ext.asyncio import AsyncSession
from app.services.intelligence.summarizer import summarizer_service
from app.repositories.event_repo import EventRepo
from app.repositories.artifact_repo import ArtifactRepo
from app.repositories.action_item_repo import ActionItemRepo
from app.models.enums import ArtifactType, ActionItemStatus

logger = logging.getLogger(__name__)

class IntelligencePipeline:
    """
    IntelligencePipeline — orchestrates the processing of events into summaries and action items.
    """

    async def process_event(self, session: AsyncSession, org_id: UUID, event_id: UUID, callback_url: Optional[str] = None):
        """
        Process an event:
        1. Load event metadata
        2. Generate summary via LLM
        3. Extract action items
        4. Save artifacts and action items
        5. Notify via callback
        """
        event_repo = EventRepo(session, org_id)
        artifact_repo = ArtifactRepo(session, org_id)
        action_item_repo = ActionItemRepo(session, org_id)

        event = await event_repo.get_by_id(event_id)
        if not event:
            logger.error(f"Event {event_id} not found in org {org_id}")
            return

        logger.info(f"Processing event {event_id} (type: {event.event_type})")

        # ── Step 1: Prepare Transcript ────────────────────────────────
        # In the future, this would involve transcription of audio.
        # For now, we assume the transcript or content is in raw_content_json.
        content = event.raw_content_json.get("transcript") or event.raw_content_json.get("text")
        if not content:
            logger.warning(f"No content to process for event {event_id}")
            return

        # ── Step 2: Generate Summary ──────────────────────────────────
        # Use default prompts (ported from legacy code)
        system_prompt = "You are a helpful assistant that summarizes meetings and chats."
        user_prompt = f"Please summarize the following content:\n\n{content}"

        try:
            summary_text = await summarizer_service.summarize(
                prompt=user_prompt,
                system_prompt=system_prompt
            )
            
            # Save Summary Artifact
            summary_artifact = await artifact_repo.create({
                "event_id": event_id,
                "artifact_type": ArtifactType.SUMMARY,
                "content": summary_text,
                "metadata_json": {"version": "1.0"}
            })
            logger.info(f"Summary generated for event {event_id}")

            # ── Step 3: Extract Action Items ──────────────────────────
            # (Simplified extraction for the prototype)
            await self._extract_action_items(action_item_repo, summary_artifact.id, summary_text)

            # ── Step 4: Callback Notification ─────────────────────────
            if callback_url:
                await self._notify_callback(callback_url, event_id, summary_text)

        except Exception as e:
            logger.error(f"Failed to process event {event_id}: {str(e)}")
            raise

    async def _notify_callback(self, url: str, event_id: UUID, summary: str):
        import httpx
        try:
            async with httpx.AsyncClient() as client:
                await client.post(url, json={
                    "event_id": str(event_id),
                    "status": "completed",
                    "summary": summary
                })
            logger.info(f"Callback successful for event {event_id}")
        except Exception as e:
            logger.error(f"Callback failed for event {event_id}: {str(e)}")

    async def _extract_action_items(self, repo: ActionItemRepo, artifact_id: UUID, text: str):
        # A real implementation would use an LLM with structured output (e.g. JSON mode)
        # For the prototype, we'll look for lines starting with "- [ ]" or "Action Item:"
        lines = text.split("\n")
        for line in lines:
            line = line.strip()
            if line.startswith("- [ ]") or line.lower().startswith("action item:"):
                item_text = line.replace("- [ ]", "").replace("Action Item:", "").strip()
                if item_text:
                    await repo.create({
                        "artifact_id": artifact_id,
                        "text": item_text,
                        "status": ActionItemStatus.OPEN
                    })


# Singleton instance
intelligence_pipeline = IntelligencePipeline()
