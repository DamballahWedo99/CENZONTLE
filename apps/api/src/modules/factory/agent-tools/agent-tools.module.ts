import { Module } from '@nestjs/common';
import { DocumentsModule } from '../../documents/documents.module';
import { CodeRepositoriesModule } from '../../code-repositories/code-repositories.module';
// Tools vestigiales — mantienen archivo pero NO se registran:
// - CodeExplorerTool: buscaba en markdown del Vault con nombre engañoso ("explore_code"
//   sonaba a explorar código). Reemplazada por code_* (para código real) y
//   vault_* (para Vault). Reactivable agregándola a TOOLS si se necesita.
// - DefinitionsSearchTool: Octokit loop lento (60+ API calls, 5-10s). Reemplazada
//   por VaultGrepTool que usa ripgrep sobre clone local (<300ms, regex completo).
import { InitiativeDocumentsTool } from './initiative-documents.tool';
import { CodeGlobTool } from './code-glob.tool';
import { CodeGrepTool } from './code-grep.tool';
import { CodeReadTool } from './code-read.tool';
import { VaultGlobTool } from './vault-glob.tool';
import { VaultGrepTool } from './vault-grep.tool';
import { VaultReadTool } from './vault-read.tool';

const TOOLS = [
  InitiativeDocumentsTool,
  CodeGlobTool,
  CodeGrepTool,
  CodeReadTool,
  VaultGlobTool,
  VaultGrepTool,
  VaultReadTool,
];

@Module({
  imports: [DocumentsModule, CodeRepositoriesModule],
  providers: TOOLS,
  exports: TOOLS,
})
export class AgentToolsModule {}
