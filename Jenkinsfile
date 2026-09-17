// Rankwatch data refresh — runs on Aaron's Jenkins (dev3), daily.
//
// One-time setup on the Jenkins side (see README's "Jenkins setup" section
// for the full walkthrough):
//   1. An SSH credential with write access to this repo, ID: popularapps-deploy-key
//   2. A Pipeline job (or Multibranch Pipeline) pointing at this repo, reading
//      this Jenkinsfile.
//
// This replaces the schedule that used to live in
// .github/workflows/update-data.yml (that workflow now only runs on manual
// workflow_dispatch, as a fallback). Pushing here with a real credential
// (not GitHub's default GITHUB_TOKEN) triggers deploy-pages.yml normally.

pipeline {
  agent any

  triggers {
    // Once a day. 'H' picks a stable-but-unpredictable minute in the hour
    // so this job doesn't hammer dev3 at the exact same instant as every
    // other cron job on the box.
    cron('H 6 * * *')
  }

  options {
    timestamps()
    disableConcurrentBuilds()
    timeout(time: 20, unit: 'MINUTES')
  }

  environment {
    GIT_SSH_REMOTE = 'git@github.com:aaron777collins/popularapps.git'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Fetch App Store data') {
      steps {
        sh 'node --version'
        sh 'node scripts/fetch-data.mjs'
      }
    }

    stage('Commit and push if changed') {
      steps {
        sshagent(credentials: ['popularapps-deploy-key']) {
          sh '''
            set -e
            git config user.name "jenkins-bot"
            git config user.email "jenkins@aaroncollins.info"
            git remote set-url origin "$GIT_SSH_REMOTE"

            git add data/latest.json data/history.json

            if git diff --cached --quiet; then
              echo "No data changes, nothing to commit."
            else
              git commit -m "chore: update app store data (jenkins/dev3)"
              git push origin HEAD:main
            fi
          '''
        }
      }
    }
  }

  post {
    failure {
      echo 'Rankwatch data refresh failed — check the stage logs above.'
    }
  }
}
