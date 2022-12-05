describe('Đăng nhập không cần password', function() {
    it('Đăng nhập với email tồn tại', () => {
        cy.request({
            method: 'POST',
            url: 'api/v1/user/auth/login',
            body: {
                "email": "tuan@gmail.com"
            },
            failOnStatusCode: false
        }).should(({ status, body }) => {
            expect(status).to.eq(200);
            expect(body.status).to.eq('success');
            expect(body.message).to.eq('Đăng nhập thành công !');
        })
    });

    it('Đăng nhập với email không tồn tại', () => {
        cy.request({
            method: 'POST',
            url: 'api/v1/user/auth/login',
            body: {
                "email": "tuan12@gmail.com"
            },
            failOnStatusCode: false
        }).should(({ status, body }) => {
            expect(status).to.eq(500);
            expect(body.status).to.eq('error');
            expect(body.message).to.eq('Tài khoản không tồn tại !');
        })
    });
});

describe('Đăng nhập sử dụng token', function() {
    it('Đăng nhập với header không tồn tại app_id', () => {
        cy.request({
            method: 'GET',
            url: `api/v1/user/auth/login-token?token=12121212`,
            failOnStatusCode: false
        }).should(({ status, body }) => {
            expect(status).to.eq(400);
            expect(body.status).to.eq('fail');
            expect(body.message).to.eq('Thêm app_id vào header với value theo nhóm: vy01, vy02, vy03, vy04. Ví dụ: app_id: vy03');
        })
    });

    beforeEach(() => {
        cy.request('POST', 'api/v1/user/auth/login', { email: 'tuan@gmail.com' })
          .its('data')
          .as('currentUser')
    })

    it('Đăng nhập với token không hợp lệ', () => {
        cy.request({
            method: 'GET',
            url: `api/v1/user/auth/login-token?=eyJhbGciOiJIUzI1N3333iIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiaWF0IjoxNjcwMjYwOTEzLCJleHAiOjE2NzgwMzY5MTN9.J-KzBJ0FFc7iaA8nIbInMJJFjKJ98Q4Bb-W232323`,
            headers: {
                'app_id': 'vy03'
            },
            failOnStatusCode: false
        }).should(({ status, body }) => {
            expect(status).to.eq(400);
            expect(body.status).to.eq('fail');
            expect(body.message).to.eq('Token không hợp lệ !');
        })
    });

    it('Đăng nhập với token hợp lệ', () => {
        const { token } = this.currentUser;
        cy.request({
            method: 'GET',
            url: `api/v1/user/auth/login-token?=${token}`,
            headers: {
                'app_id': 'vy03'
            },
            failOnStatusCode: false
        }).should(({ status, body }) => {
            expect(status).to.eq(200);
            expect(body.status).to.eq('success');
            expect(body.message).to.eq('Đăng nhập thành công !');
        })
    });
});
