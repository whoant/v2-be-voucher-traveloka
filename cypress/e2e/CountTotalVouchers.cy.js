describe('Đếm tổng số voucher của partner', function() {
    const accessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoidm92YW5ob2FuZ3R1YW4iLCJ1c2VybmFtZSI6InZvdmFuaG9hbmd0dWFuIiwiZW1haWwiOiJ2b3ZhbmhvYW5ndHVhbjQuMkBnbWFpbC5jb20iLCJzdWIiOiI0MjczRDQ0RS0xMDI0LTQ0OUQtOUQxQS0wOUQyQjlBMThGRUYiLCJ0eXBlIjoiUEFSVE5FUiIsImFwcElkIjoidnkwMyIsInNlcnZpY2VzIjpbIlZJTExBLUFQQVJUTUVOVCIsIkZMSUdIVCIsIkNBUi1SRU5UQUwiLCJBSVJQT1JULVBJQ0tMRVMiLCJIT1RFTCIsIlRPVVIiLCJSRVNUQVVSQU5UIiwiVk9VQ0hFUiIsIlNBVklORy1DT01CTyJdLCJpYXQiOjE2NzEyOTg5NjksImV4cCI6MTY3OTA3NDk2OX0.nq-PPy3qakXT-nmbJKqciDZXKnPfv07oP7PMRlEgkmA';

    it('Voucher đã tồn tại', () => {
        cy.request({
            method: 'GET',
            url: 'api/v1/partner/voucher/count',
            failOnStatusCode: false,
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        }).should(({ status, body }) => {
            expect(status).to.eq(200);
            expect(body.status).to.eq('success');
            expect(body.message).to.eq('Lấy thông tin thành công !');
        })
    });

});
