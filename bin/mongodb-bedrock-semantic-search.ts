#!/usr/bin/env node
import 'source-map-support/register';
import { App, Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { MongodbBedrockSemanticSearchStack } from '../lib/mongodb-bedrock-semantic-search-stack';

const app = new App();
new MongodbBedrockSemanticSearchStack(
  app,
  'MongodbBedrockSemanticSearchStack',
  {},
);
Aspects.of(app).add(new AwsSolutionsChecks({}));
