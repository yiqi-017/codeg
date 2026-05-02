use crate::models::agent::AgentType;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub enum AgentDistribution {
    Npx {
        version: &'static str,
        package: &'static str,
        /// The command name provided by this npx package (e.g. "gemini", "openclaw").
        cmd: &'static str,
        args: &'static [&'static str],
        env: &'static [(&'static str, &'static str)],
        /// Minimum Node.js version required, e.g. "22.12.0". None means no specific requirement.
        node_required: Option<&'static str>,
    },
    Binary {
        version: &'static str,
        cmd: &'static str,
        args: &'static [&'static str],
        env: &'static [(&'static str, &'static str)],
        platforms: &'static [PlatformBinary],
    },
    Local {
        version: &'static str,
    },
}

#[derive(Debug, Clone)]
pub struct PlatformBinary {
    pub platform: &'static str,
    pub url: &'static str,
}

#[derive(Debug, Clone)]
pub struct AcpAgentMeta {
    pub agent_type: AgentType,
    pub name: &'static str,
    pub description: &'static str,
    pub distribution: AgentDistribution,
}

impl AcpAgentMeta {
    pub fn registry_version(&self) -> Option<&'static str> {
        match &self.distribution {
            AgentDistribution::Npx { version, .. }
            | AgentDistribution::Binary { version, .. }
            | AgentDistribution::Local { version } => Some(*version),
        }
    }
}

pub fn genericagent_bridge_override() -> Option<PathBuf> {
    std::env::var_os("CODEG_GENERICAGENT_BRIDGE").map(PathBuf::from)
}

pub fn find_genericagent_bridge() -> Option<PathBuf> {
    if let Some(path) = genericagent_bridge_override() {
        if path.is_file() {
            return Some(path);
        }
    }

    let rel = Path::new("GenericAgent").join("genericagent_acp_bridge.py");
    let mut roots = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.to_path_buf());
        }
    }

    for root in roots {
        for base in root.ancestors() {
            let candidate = base.join(&rel);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

pub fn find_genericagent_python() -> Option<String> {
    // Prefer `py` (Python Launcher) on Windows — it resolves to the system
    // default Python regardless of conda/venv PATH modifications.
    #[cfg(target_os = "windows")]
    let candidates = ["py", "python"];
    #[cfg(not(target_os = "windows"))]
    let candidates = ["python3", "python"];

    for cmd in candidates {
        if let Ok(path) = which::which(cmd) {
            return Some(path.to_string_lossy().to_string());
        }
    }
    None
}

pub fn current_platform() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "darwin-aarch64"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "darwin-x86_64"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "linux-aarch64"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "linux-x86_64"
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        "windows-aarch64"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "windows-x86_64"
    }
}

pub fn all_acp_agents() -> Vec<AgentType> {
    vec![
        AgentType::ClaudeCode,
        AgentType::Codex,
        AgentType::GenericAgent,
        AgentType::Gemini,
        AgentType::OpenClaw,
        AgentType::OpenCode,
        AgentType::Cline,
    ]
}

pub fn registry_id_for(agent_type: AgentType) -> &'static str {
    match agent_type {
        AgentType::ClaudeCode => "claude-acp",
        AgentType::Codex => "codex-acp",
        AgentType::GenericAgent => "genericagent-local",
        AgentType::Gemini => "gemini",
        AgentType::OpenClaw => "openclaw-acp",
        AgentType::OpenCode => "opencode",
        AgentType::Cline => "cline",
    }
}

pub fn from_registry_id(id: &str) -> Option<AgentType> {
    match id {
        "claude-acp" => Some(AgentType::ClaudeCode),
        "codex-acp" => Some(AgentType::Codex),
        "genericagent-local" => Some(AgentType::GenericAgent),
        "gemini" => Some(AgentType::Gemini),
        "openclaw-acp" => Some(AgentType::OpenClaw),
        "opencode" => Some(AgentType::OpenCode),
        "cline" => Some(AgentType::Cline),
        _ => None,
    }
}

pub fn get_agent_meta(agent_type: AgentType) -> AcpAgentMeta {
    debug_assert_eq!(
        from_registry_id(registry_id_for(agent_type)),
        Some(agent_type)
    );
    match agent_type {
        AgentType::ClaudeCode => AcpAgentMeta {
            agent_type,
            name: "Claude Code",
            description: "ACP wrapper for Anthropic's Claude",
            distribution: AgentDistribution::Npx {
                version: "0.31.0",
                package: "@agentclientprotocol/claude-agent-acp@0.31.0",
                cmd: "claude-agent-acp",
                args: &[],
                env: &[],
                node_required: None,
            },
        },
        AgentType::Codex => AcpAgentMeta {
            agent_type,
            name: "Codex CLI",
            description: "ACP adapter for OpenAI's coding assistant",
            distribution: AgentDistribution::Binary {
                version: "0.12.0",
                cmd: "codex-acp",
                args: &[],
                env: &[],
                platforms: &[
                    PlatformBinary {
                        platform: "darwin-aarch64",
                        url: "https://github.com/zed-industries/codex-acp/releases/download/v0.12.0/codex-acp-0.12.0-aarch64-apple-darwin.tar.gz",
                    },
                    PlatformBinary {
                        platform: "darwin-x86_64",
                        url: "https://github.com/zed-industries/codex-acp/releases/download/v0.12.0/codex-acp-0.12.0-x86_64-apple-darwin.tar.gz",
                    },
                    PlatformBinary {
                        platform: "linux-aarch64",
                        url: "https://github.com/zed-industries/codex-acp/releases/download/v0.12.0/codex-acp-0.12.0-aarch64-unknown-linux-gnu.tar.gz",
                    },
                    PlatformBinary {
                        platform: "linux-x86_64",
                        url: "https://github.com/zed-industries/codex-acp/releases/download/v0.12.0/codex-acp-0.12.0-x86_64-unknown-linux-gnu.tar.gz",
                    },
                    PlatformBinary {
                        platform: "windows-aarch64",
                        url: "https://github.com/zed-industries/codex-acp/releases/download/v0.12.0/codex-acp-0.12.0-aarch64-pc-windows-msvc.zip",
                    },
                    PlatformBinary {
                        platform: "windows-x86_64",
                        url: "https://github.com/zed-industries/codex-acp/releases/download/v0.12.0/codex-acp-0.12.0-x86_64-pc-windows-msvc.zip",
                    },
                ],
            },
        },
        AgentType::GenericAgent => AcpAgentMeta {
            agent_type,
            name: "GenericAgent",
            description: "Local ACP bridge for the GenericAgent Python project",
            distribution: AgentDistribution::Local { version: "0.1.0" },
        },
        AgentType::Gemini => AcpAgentMeta {
            agent_type,
            name: "Gemini CLI",
            description: "Google's official CLI for Gemini",
            distribution: AgentDistribution::Npx {
                version: "0.39.1",
                package: "@google/gemini-cli@0.39.1",
                cmd: "gemini",
                args: &["--acp"],
                env: &[],
                node_required: None,
            },
        },
        AgentType::OpenClaw => AcpAgentMeta {
            agent_type,
            name: "OpenClaw",
            description: "OpenClaw is a personal AI assistant you run on your own devices.",
            distribution: AgentDistribution::Npx {
                version: "2026.4.15",
                package: "openclaw@2026.4.15",
                cmd: "openclaw",
                args: &["acp"],
                env: &[],
                node_required: Some("22.12.0"),
            },
        },
        AgentType::Cline => AcpAgentMeta {
            agent_type,
            name: "Cline",
            description: "Autonomous coding agent CLI",
            distribution: AgentDistribution::Npx {
                version: "2.15.0",
                package: "cline@2.15.0",
                cmd: "cline",
                args: &["--acp"],
                env: &[],
                node_required: None,
            },
        },
        AgentType::OpenCode => AcpAgentMeta {
            agent_type,
            name: "OpenCode",
            description: "The open source coding agent",
            distribution: AgentDistribution::Binary {
                version: "1.14.23",
                cmd: "opencode",
                args: &["acp"],
                env: &[],
                platforms: &[
                    PlatformBinary {
                        platform: "darwin-aarch64",
                        url: "https://github.com/anomalyco/opencode/releases/download/v1.14.23/opencode-darwin-arm64.zip",
                    },
                    PlatformBinary {
                        platform: "darwin-x86_64",
                        url: "https://github.com/anomalyco/opencode/releases/download/v1.14.23/opencode-darwin-x64.zip",
                    },
                    PlatformBinary {
                        platform: "linux-aarch64",
                        url: "https://github.com/anomalyco/opencode/releases/download/v1.14.23/opencode-linux-arm64.tar.gz",
                    },
                    PlatformBinary {
                        platform: "linux-x86_64",
                        url: "https://github.com/anomalyco/opencode/releases/download/v1.14.23/opencode-linux-x64.tar.gz",
                    },
                    PlatformBinary {
                        platform: "windows-aarch64",
                        url: "https://github.com/anomalyco/opencode/releases/download/v1.14.23/opencode-windows-arm64.zip",
                    },
                    PlatformBinary {
                        platform: "windows-x86_64",
                        url: "https://github.com/anomalyco/opencode/releases/download/v1.14.23/opencode-windows-x64.zip",
                    },
                ],
            },
        },
    }
}
