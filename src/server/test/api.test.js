const request = require('supertest');
const app = require('../server');
const { expect } = require('chai');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs-extra');
const path = require('path');

// Use the same database path as the server (or a test-specific one)
const db = new sqlite3.Database('../../database/database.db');

// Clean up test data before each test
beforeEach(function(done) {
  db.run("DELETE FROM participant_feedback WHERE participant_id LIKE 'test%'", done);
});

describe('POST /write_db', function() {
  this.timeout(5000);

  it('should store a new diagnosis', function(done) {
    const payload = {
      participant_id: 'test123',
      study_id: '411',
      xray_image: 'test.png',
      participant_diagnosis: 'healthy',
      page_nr: 1
    };

    request(app)
      .post('/write_db')
      .send(payload)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.message).to.include('success');
        done();
      });
  });

  it('should skip update if diagnosis unchanged', function(done) {
    const payload = {
      participant_id: 'test123',
      study_id: '411',
      xray_image: 'test.png',
      participant_diagnosis: 'healthy',
      page_nr: 1
    };

    // First insert
    request(app)
      .post('/write_db')
      .send(payload)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        // Then try again – should skip
        request(app)
          .post('/write_db')
          .send(payload)
          .expect(200)
          .end((err2, res2) => {
            if (err2) return done(err2);
            expect(res2.body.message).to.equal('Diagnosis unchanged, no update needed.');
            done();
          });
      });
  });

  it('should return 400 if required fields missing', function(done) {
    const payload = {
      participant_id: 'test123',
      study_id: '411',
      // missing participant_diagnosis
      page_nr: 1
    };
    request(app)
      .post('/write_db')
      .send(payload)
      .expect(400)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.error).to.include('Missing required fields');
        done();
      });
  });
});

describe('GET /read_db_prev', function() {
  it('should return the diagnosis for a given page', function(done) {
    // First insert a record
    const payload = {
      participant_id: 'test456',
      study_id: '411',
      xray_image: 'test.png',
      participant_diagnosis: 'unhealthy',
      page_nr: 3
    };
    request(app)
      .post('/write_db')
      .send(payload)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        // Now read it back
        request(app)
          .get('/read_db_prev')
          .query({ participant_id: 'test456', study_id: '411', page_nr: 3 })
          .expect(200)
          .end((err2, res2) => {
            if (err2) return done(err2);
            expect(res2.body).to.be.an('array');
            expect(res2.body[0].participant_diagnosis).to.equal('OCDegen');
            done();
          });
      });
  });
});

describe('POST /log_visit', function() {
  it('should log a page visit', function(done) {
    const payload = {
      participant_id: 'test789',
      study_id: '411',
      page_nr: 1
    };
    request(app)
      .post('/log_visit')
      .send(payload)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.success).to.be.true;
        done();
      });
  });

  it('should return 400 if fields missing', function(done) {
    const payload = {
      participant_id: 'test789',
      // missing study_id
      page_nr: 1
    };
    request(app)
      .post('/log_visit')
      .send(payload)
      .expect(400)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.error).to.include('missing fields');
        done();
      });
  });
});

describe('GET /read_db', function() {
  it('should return all feedback records', function(done) {
    request(app)
      .get('/read_db')
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body).to.be.an('array');
        done();
      });
  });
});

describe('POST /create-study', function() {
  it('should return 500 for invalid ZIP format', function(done) {
    const csvContent = `PATIENT_ID,X_RAY_IMAGE,TRUE_DIAG,SUGGESTED_DIAG,X_RAY_LOCATION,X_RAY_TRAIT
P001,img1.png,Healthy,Healthy,NYC,"No Trait"
P002,img2.png,OCDegen,OCDegen,LA,"Strong Spine Bend"`;
    const zipBuffer = Buffer.from(''); // empty => invalid ZIP

    request(app)
      .post('/create-study')
      .field('study_id', '999')
      .field('study_type', '2')
      .attach('csv', Buffer.from(csvContent), 'test.csv')
      .attach('zip', zipBuffer, 'test.zip')
      .expect(500)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.error).to.include('Invalid or unsupported zip format');
        done();
      });
  });

  it('should return 400 if CSV or ZIP missing', function(done) {
    request(app)
      .post('/create-study')
      .field('study_id', '999')
      .field('study_type', '2')
      .expect(400)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.error).to.include('CSV and ZIP files are required');
        done();
      });
  });
});