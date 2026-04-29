use crate::models::{ConversationDetail, ConversationSummary};
use crate::parsers::{AgentParser, ParseError};

pub struct GenericAgentParser;

impl GenericAgentParser {
    pub fn new() -> Self {
        Self
    }
}

impl AgentParser for GenericAgentParser {
    fn list_conversations(&self) -> Result<Vec<ConversationSummary>, ParseError> {
        Ok(Vec::new())
    }

    fn get_conversation(&self, conversation_id: &str) -> Result<ConversationDetail, ParseError> {
        Err(ParseError::ConversationNotFound(conversation_id.to_string()))
    }
}
